import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { IQueue, QueuedDocument } from './queue';
import { CodeChunk } from './elasticsearch';
import { logger, createLogger } from './logger';
import { createMetrics, Metrics, createAttributes } from './metrics';
import { QUEUE_STATUS_PENDING, QUEUE_STATUS_PROCESSING, QUEUE_STATUS_FAILED, CHUNK_TYPE_CODE } from './constants';

export const MAX_RETRIES = 3;
const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface SqliteQueueOptions {
  dbPath: string;
  repoName?: string;
  branch?: string;
}

export class SqliteQueue implements IQueue {
  private db: Database.Database;
  private logger: ReturnType<typeof createLogger>;
  private metrics: Metrics;

  constructor(options: SqliteQueueOptions) {
    const { dbPath, repoName, branch } = options;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.logger = repoName && branch 
      ? createLogger({ name: repoName, branch })
      : logger;
    this.metrics = repoName && branch
      ? createMetrics({ name: repoName, branch })
      : createMetrics();
  }

  async initialize(): Promise<void> {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        document TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '${QUEUE_STATUS_PENDING}',
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processing_started_at TIMESTAMP
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_status ON queue (status);');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_batch_id ON queue (batch_id);');
    
    // Set up observable gauges for queue sizes
    this.setupQueueGauges();
  }

  /**
   * Sets up observable gauges to report current queue sizes by status.
   */
  private setupQueueGauges(): void {
    if (!this.metrics.queue) {
      return;
    }

    // Observable gauge for pending documents
    this.metrics.queue.queueSizePending.addCallback((observableResult) => {
      const stats = this.getQueueStats();
      observableResult.observe(stats.pending, createAttributes(this.metrics, { status: QUEUE_STATUS_PENDING }));
    });

    // Observable gauge for processing documents
    this.metrics.queue.queueSizeProcessing.addCallback((observableResult) => {
      const stats = this.getQueueStats();
      observableResult.observe(stats.processing, createAttributes(this.metrics, { status: QUEUE_STATUS_PROCESSING }));
    });

    // Observable gauge for failed documents
    this.metrics.queue.queueSizeFailed.addCallback((observableResult) => {
      const stats = this.getQueueStats();
      observableResult.observe(stats.failed, createAttributes(this.metrics, { status: QUEUE_STATUS_FAILED }));
    });
  }

  /**
   * Gets current queue statistics by status.
   * 
   * @returns Object with counts for pending, processing, and failed documents
   */
  private getQueueStats(): { pending: number; processing: number; failed: number } {
    const stmt = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM queue
      GROUP BY status
    `);
    const rows = stmt.all() as { status: string; count: number }[];
    
    const stats = { pending: 0, processing: 0, failed: 0 };
    for (const row of rows) {
      if (row.status === QUEUE_STATUS_PENDING) {
        stats.pending = row.count;
      } else if (row.status === QUEUE_STATUS_PROCESSING) {
        stats.processing = row.count;
      } else if (row.status === QUEUE_STATUS_FAILED) {
        stats.failed = row.count;
      }
    }
    
    return stats;
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
    this.logger.info(`Enqueued batch of ${documents.length} documents with batch_id: ${batchId}`);
    
    // Record enqueue metrics
    this.metrics.queue?.documentsEnqueued.add(documents.length, createAttributes(this.metrics));
  }

  async dequeue(count: number): Promise<QueuedDocument[]> {
    const selectStmt = this.db.prepare(`
      SELECT id, batch_id, document
      FROM queue
      WHERE status = '${QUEUE_STATUS_PENDING}'
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
        SET status = '${QUEUE_STATUS_PROCESSING}', processing_started_at = CURRENT_TIMESTAMP
        WHERE id IN (${ids.map(() => '?').join(',')})
    `);
    updateStmt.run(...ids);

    // Record dequeue metrics
    this.metrics.queue?.documentsDequeued.add(rows.length, createAttributes(this.metrics));

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
    this.logger.info(`Committed and deleted ${result.changes} documents.`);
    
    // Record commit and delete metrics
    this.metrics.queue?.documentsCommitted.add(result.changes, createAttributes(this.metrics));
    this.metrics.queue?.documentsDeleted.add(result.changes, createAttributes(this.metrics));
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
            `UPDATE queue SET status = '${QUEUE_STATUS_PENDING}', retry_count = retry_count + 1, processing_started_at = NULL WHERE id IN (${toRequeue.map(() => '?').join(',')})`
        );
        requeueStmt.run(...toRequeue);
        this.logger.warn(`Requeued ${toRequeue.length} documents.`);
        
        // Record requeue metrics
        this.metrics.queue?.documentsRequeued.add(toRequeue.length, createAttributes(this.metrics));
    }

    if (toFail.length > 0) {
        const failStmt = this.db.prepare(
            `UPDATE queue SET status = '${QUEUE_STATUS_FAILED}' WHERE id IN (${toFail.map(() => '?').join(',')})`
        );
        failStmt.run(...toFail);
        this.logger.error(`Moved ${toFail.length} documents to failed status after ${MAX_RETRIES} retries.`);
        
        // Record failed metrics
        this.metrics.queue?.documentsFailed.add(toFail.length, createAttributes(this.metrics));
    }
  }

  async requeueStaleTasks(): Promise<void> {
    const staleTimestamp = new Date(Date.now() - STALE_TIMEOUT_MS).toISOString();
    const selectStmt = this.db.prepare(`
        SELECT id FROM queue
        WHERE status = '${QUEUE_STATUS_PROCESSING}' AND processing_started_at < ?
    `);
    const staleTasks = selectStmt.all(staleTimestamp) as { id: number }[];

    if (staleTasks.length > 0) {
        const ids = staleTasks.map(t => t.id);
        this.logger.warn(`Found ${ids.length} stale tasks. Re-queueing...`);
        
        const documentsToRequeue: QueuedDocument[] = staleTasks.map(t => ({
            id: `stale_${t.id}`,
            document: {
                type: CHUNK_TYPE_CODE,
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