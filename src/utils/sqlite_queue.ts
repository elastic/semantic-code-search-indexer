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

/**
 * Check if a process with the given PID is currently running.
 *
 * @param pid - Process ID to check
 * @returns true if process is running, false otherwise
 */
function isProcessRunning(pid: number | null): boolean {
  if (pid === null || pid === undefined) {
    return false;
  }

  try {
    // Sending signal 0 doesn't actually send a signal,
    // it just checks if the process exists and we have permission to signal it
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH means "No such process" - process doesn't exist
    // EPERM means "Operation not permitted" - process exists but we can't signal it
    // For our purposes, if we can't signal it, treat it as not running
    return false;
  }
}

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
    this.logger = repoName && branch ? createLogger({ name: repoName, branch }) : logger;
    this.metrics = repoName && branch ? createMetrics({ name: repoName, branch }) : createMetrics();
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
        processing_started_at TIMESTAMP,
        worker_pid INTEGER
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_status ON queue (status);');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_batch_id ON queue (batch_id);');

    // Create metadata table for tracking enqueue completion
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migration: Add worker_pid column if it doesn't exist (for existing databases)
    try {
      this.db.exec('ALTER TABLE queue ADD COLUMN worker_pid INTEGER;');
      this.logger.info('Added worker_pid column to queue table');
    } catch {
      // Column already exists, ignore error
    }

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
    const insert = this.db.prepare('INSERT INTO queue (batch_id, document) VALUES (?, ?)');
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
    const currentPid = process.pid;

    // Use UPDATE ... RETURNING to atomically claim rows for this worker
    // This prevents race conditions when multiple workers dequeue concurrently
    const updateStmt = this.db.prepare(`
      UPDATE queue
      SET 
        status = '${QUEUE_STATUS_PROCESSING}',
        processing_started_at = CURRENT_TIMESTAMP,
        worker_pid = ?
      WHERE id IN (
        SELECT id
        FROM queue
        WHERE status = '${QUEUE_STATUS_PENDING}'
        ORDER BY created_at
        LIMIT ?
      )
      RETURNING id, batch_id, document
    `);

    const rows = updateStmt.all(currentPid, count) as { id: number; batch_id: string; document: string }[];

    if (rows.length === 0) {
      return [];
    }

    // Record dequeue metrics
    this.metrics.queue?.documentsDequeued.add(rows.length, createAttributes(this.metrics));

    return rows.map((row) => ({
      id: `${row.batch_id}_${row.id}`, // Composite ID
      document: JSON.parse(row.document),
    }));
  }

  async commit(documents: QueuedDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    const ids = documents.map((d) => parseInt(d.id.split('_').pop() || '0', 10));
    const deleteStmt = this.db.prepare(`DELETE FROM queue WHERE id IN (${ids.map(() => '?').join(',')})`);
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
    const ids = documents.map((d) => parseInt(d.id.split('_').pop() || '0', 10));

    const selectRetriesStmt = this.db.prepare(
      `SELECT id, retry_count FROM queue WHERE id IN (${ids.map(() => '?').join(',')})`
    );
    const rowsToRequeue = selectRetriesStmt.all(...ids) as { id: number; retry_count: number }[];

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
        `UPDATE queue SET status = '${QUEUE_STATUS_PENDING}', retry_count = retry_count + 1, processing_started_at = NULL, worker_pid = NULL WHERE id IN (${toRequeue.map(() => '?').join(',')})`
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
    // Get all items currently in processing status with their PIDs
    const selectStmt = this.db.prepare(`
        SELECT id, worker_pid, processing_started_at FROM queue
        WHERE status = ?
    `);
    const processingItems = selectStmt.all(QUEUE_STATUS_PROCESSING) as {
      id: number;
      worker_pid: number | null;
      processing_started_at: string;
    }[];

    if (processingItems.length === 0) {
      return;
    }

    this.logger.info(`Checking ${processingItems.length} items in processing status for stale tasks...`);

    const itemsToRequeue: number[] = [];
    const staleTimeMs = Date.now() - STALE_TIMEOUT_MS;

    // Group items by PID for efficient checking
    const itemsByPid = new Map<number | null, number[]>();
    for (const item of processingItems) {
      const pid = item.worker_pid;
      if (!itemsByPid.has(pid)) {
        itemsByPid.set(pid, []);
      }
      itemsByPid.get(pid)!.push(item.id);
    }

    // Check each PID
    for (const [pid, itemIds] of itemsByPid.entries()) {
      if (pid === null) {
        // No PID recorded (old items before PID tracking was added)
        // Fall back to time-based check for these items
        this.logger.info(`Found ${itemIds.length} items with no PID (legacy items), checking by timestamp...`);
        for (const item of processingItems.filter((i) => i.worker_pid === null)) {
          // Parse timestamp to Date and compare as numbers
          // SQLite CURRENT_TIMESTAMP returns UTC without 'Z', so append 'Z' if missing to parse as UTC
          let timestamp = item.processing_started_at;
          if (!timestamp.endsWith('Z') && !timestamp.includes('+')) {
            timestamp = timestamp.replace(' ', 'T') + 'Z';
          }
          const itemStartTime = new Date(timestamp).getTime();
          if (isNaN(itemStartTime)) {
            // Invalid timestamp - requeue to be safe
            this.logger.warn(`Item ${item.id} has invalid timestamp '${item.processing_started_at}'. Requeuing.`);
            itemsToRequeue.push(item.id);
          } else if (itemStartTime < staleTimeMs) {
            itemsToRequeue.push(item.id);
          }
        }
      } else if (!isProcessRunning(pid)) {
        // Process is dead - requeue ALL items from this PID immediately
        this.logger.warn(`Worker process ${pid} is not running. Requeuing ${itemIds.length} items immediately.`);
        itemsToRequeue.push(...itemIds);
      } else {
        // Process is still running - check if items are stale (hung/stuck)
        for (const item of processingItems.filter((i) => i.worker_pid === pid)) {
          // Parse timestamp to Date and compare as numbers
          // SQLite CURRENT_TIMESTAMP returns UTC without 'Z', so append 'Z' if missing to parse as UTC
          let timestamp = item.processing_started_at;
          if (!timestamp.endsWith('Z') && !timestamp.includes('+')) {
            timestamp = timestamp.replace(' ', 'T') + 'Z';
          }
          const itemStartTime = new Date(timestamp).getTime();
          if (isNaN(itemStartTime)) {
            // Invalid timestamp - requeue to be safe
            this.logger.warn(`Item ${item.id} has invalid timestamp '${item.processing_started_at}'. Requeuing.`);
            itemsToRequeue.push(item.id);
          } else if (itemStartTime < staleTimeMs) {
            this.logger.warn(
              `Worker process ${pid} is running but item ${item.id} has been processing for >${STALE_TIMEOUT_MS / 1000}s. Requeuing...`
            );
            itemsToRequeue.push(item.id);
          }
        }
      }
    }

    if (itemsToRequeue.length > 0) {
      this.logger.warn(`Requeuing ${itemsToRequeue.length} stale/orphaned tasks...`);

      const documentsToRequeue: QueuedDocument[] = itemsToRequeue.map((id) => ({
        id: `stale_${id}`,
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
        },
      }));

      await this.requeue(documentsToRequeue);
    } else {
      this.logger.info(`All ${processingItems.length} processing items are from active workers and recent.`);
    }
  }

  /**
   * Clear all pending and processing items from the queue
   * Used when doing a clean reindex to start fresh
   */
  async clear(): Promise<void> {
    this.logger.info('Clearing queue (removing all pending and processing items)');
    const result = this.db.prepare("DELETE FROM queue WHERE status IN ('pending', 'processing')").run();
    this.logger.info(`Cleared ${result.changes} items from queue`);

    // Also clear the enqueue_completed flag
    this.db.prepare("DELETE FROM queue_metadata WHERE key = 'enqueue_completed'").run();
  }

  /**
   * Mark enqueue as completed
   */
  async markEnqueueCompleted(): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO queue_metadata (key, value, updated_at) 
         VALUES ('enqueue_completed', 'true', CURRENT_TIMESTAMP)`
      )
      .run();
    this.logger.info('Marked enqueue as completed');
  }

  /**
   * Check if enqueue was completed
   */
  isEnqueueCompleted(): boolean {
    const result = this.db.prepare("SELECT value FROM queue_metadata WHERE key = 'enqueue_completed'").get() as
      | { value: string }
      | undefined;
    return result?.value === 'true';
  }

  close(): void {
    this.db.close();
  }
}
