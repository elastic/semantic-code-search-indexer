import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { IQueue, QueuedDocument } from './queue';
import { CodeChunk } from './elasticsearch';
import { logger } from './logger';

export const MAX_RETRIES = 3;
const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class SqliteQueue implements IQueue {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
  }

  async initialize(): Promise<void> {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        document TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processing_started_at TIMESTAMP
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_status ON queue (status);');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_batch_id ON queue (batch_id);');
  }

  async enqueue(documents: CodeChunk[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    const batchId = new Date().toISOString();
    const insert = this.db.prepare(
      'INSERT INTO queue (batch_id, document) VALUES (?, ?)'
    );
    const transaction = this.db.transaction((docs) => {
      for (const doc of docs) {
        insert.run(batchId, JSON.stringify(doc));
      }
    });
    transaction(documents);
    logger.info(`Enqueued batch of ${documents.length} documents with batch_id: ${batchId}`);
  }

  async dequeue(count: number): Promise<QueuedDocument[]> {
    const selectStmt = this.db.prepare(`
      SELECT id, batch_id, document
      FROM queue
      WHERE status = 'pending'
      ORDER BY created_at
      LIMIT ?
    `);

    const rows = selectStmt.all(count) as { id: number, batch_id: string, document: string }[];
    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map(r => r.id);
    const updateStmt = this.db.prepare(`
        UPDATE queue
        SET status = 'processing', processing_started_at = CURRENT_TIMESTAMP
        WHERE id IN (${ids.map(() => '?').join(',')})
    `);
    updateStmt.run(...ids);

    return rows.map(row => ({
      id: `${row.batch_id}_${row.id}`, // Composite ID
      document: JSON.parse(row.document),
    }));
  }

  async commit(documents: QueuedDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    const ids = documents.map(d => parseInt(d.id.split('_').pop() || '0', 10));
    const deleteStmt = this.db.prepare(
      `DELETE FROM queue WHERE id IN (${ids.map(() => '?').join(',')})`
    );
    const result = deleteStmt.run(...ids);
    logger.info(`Committed and deleted ${result.changes} documents.`);
  }

  async requeue(documents: QueuedDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    const ids = documents.map(d => parseInt(d.id.split('_').pop() || '0', 10));

    const selectRetriesStmt = this.db.prepare(
        `SELECT id, retry_count FROM queue WHERE id IN (${ids.map(() => '?').join(',')})`
    );
    const rowsToRequeue = selectRetriesStmt.all(...ids) as { id: number, retry_count: number }[];

    const toRequeue: number[] = [];
    const toFail: number[] = [];

    for (const row of rowsToRequeue) {
        if (row.retry_count + 1 >= MAX_RETRIES) {
            toFail.push(row.id);
        } else {
            toRequeue.push(row.id);
        }
    }

    if (toRequeue.length > 0) {
        const requeueStmt = this.db.prepare(
            `UPDATE queue SET status = 'pending', retry_count = retry_count + 1, processing_started_at = NULL WHERE id IN (${toRequeue.map(() => '?').join(',')})`
        );
        requeueStmt.run(...toRequeue);
        logger.warn(`Requeued ${toRequeue.length} documents.`);
    }

    if (toFail.length > 0) {
        const failStmt = this.db.prepare(
            `UPDATE queue SET status = 'failed' WHERE id IN (${toFail.map(() => '?').join(',')})`
        );
        failStmt.run(...toFail);
        logger.error(`Moved ${toFail.length} documents to failed status after ${MAX_RETRIES} retries.`);
    }
  }

  async requeueStaleTasks(): Promise<void> {
    const staleTimestamp = new Date(Date.now() - STALE_TIMEOUT_MS).toISOString();
    const selectStmt = this.db.prepare(`
        SELECT id FROM queue
        WHERE status = 'processing' AND processing_started_at < ?
    `);
    const staleTasks = selectStmt.all(staleTimestamp) as { id: number }[];

    if (staleTasks.length > 0) {
        const ids = staleTasks.map(t => t.id);
        logger.warn(`Found ${ids.length} stale tasks. Re-queueing...`);
        
        const documentsToRequeue: QueuedDocument[] = staleTasks.map(t => ({
            id: `stale_${t.id}`,
            document: {
                type: 'code',
                language: '',
                filePath: '',
                directoryPath: '',
                directoryName: '',
                directoryDepth: 0,
                git_file_hash: '',
                git_branch: '',
                chunk_hash: '',
                startLine: 0,
                endLine: 0,
                content: '',
                semantic_text: '',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }
        }));
        
        await this.requeue(documentsToRequeue);
    }
  }

  close(): void {
    this.db.close();
  }
}