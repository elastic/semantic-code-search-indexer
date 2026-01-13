import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { IQueue, QueuedDocument } from './queue';
import { CodeChunk } from './elasticsearch';
import { logger, createLogger } from './logger';
import { createMetrics, Metrics, createAttributes } from './metrics';
import { QUEUE_STATUS_PENDING, QUEUE_STATUS_PROCESSING, QUEUE_STATUS_FAILED } from './constants';

export const MAX_RETRIES = 3;
const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const WAL_CHECKPOINT_INTERVAL = 100; // Checkpoint every ~100 commits (10% probability per commit)

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

// Cache TTL for queue stats - prevents blocking event loop with frequent SQL queries
const STATS_CACHE_TTL_MS = 5000; // 5 seconds

export class SqliteQueue implements IQueue {
  private db: Database.Database;
  private logger: ReturnType<typeof createLogger>;
  private metrics: Metrics;
  private commitCount = 0;

  // Cache for queue stats to prevent blocking event loop during OTEL metrics export
  private cachedStats = { pending: 0, processing: 0, failed: 0 };
  private statsCacheTime = 0;

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
    // SQLite performance optimizations
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;'); // Safe for WAL mode, faster than FULL
    this.db.exec('PRAGMA cache_size = -64000;'); // 64MB cache (negative = KB)
    this.db.exec('PRAGMA temp_store = MEMORY;'); // Temp tables in memory
    this.db.exec('PRAGMA mmap_size = 268435456;'); // 256MB memory-mapped I/O
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
    // Compound index for efficient dequeue: WHERE status + ORDER BY created_at
    // This single index covers all status-based queries and provides sorted access by created_at
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_status_created ON queue (status, created_at);');

    // Create metadata table for tracking enqueue completion
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migration: Add processing_started_at column if it doesn't exist (for existing databases)
    try {
      this.db.exec('ALTER TABLE queue ADD COLUMN processing_started_at TIMESTAMP;');
      this.logger.info('Added processing_started_at column to queue table');
    } catch {
      // Column already exists, ignore error
    }

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
   * Results are cached for STATS_CACHE_TTL_MS to prevent blocking the event loop
   * during frequent OTEL metrics exports.
   *
   * @returns Object with counts for pending, processing, and failed documents
   */
  private getQueueStats(): { pending: number; processing: number; failed: number } {
    const now = Date.now();

    // Return cached stats if still valid
    if (now - this.statsCacheTime < STATS_CACHE_TTL_MS) {
      return this.cachedStats;
    }

    // Refresh cache
    const stmt = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM queue
      GROUP BY status
    `);
    const rows = stmt.all() as { status: string; count: number }[];

    this.cachedStats = { pending: 0, processing: 0, failed: 0 };
    for (const row of rows) {
      if (row.status === QUEUE_STATUS_PENDING) {
        this.cachedStats.pending = row.count;
      } else if (row.status === QUEUE_STATUS_PROCESSING) {
        this.cachedStats.processing = row.count;
      } else if (row.status === QUEUE_STATUS_FAILED) {
        this.cachedStats.failed = row.count;
      }
    }

    this.statsCacheTime = now;
    return this.cachedStats;
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

    // Batch size for SQLite operations to avoid "too many SQL variables" error
    const BATCH_SIZE = 500;

    let totalChanges = 0;

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batchIds = ids.slice(i, i + BATCH_SIZE);
      const deleteStmt = this.db.prepare(`DELETE FROM queue WHERE id IN (${batchIds.map(() => '?').join(',')})`);
      const result = deleteStmt.run(...batchIds);
      totalChanges += result.changes;
    }

    this.logger.info(`Committed and deleted ${totalChanges} documents.`);

    // Record commit and delete metrics
    this.metrics.queue?.documentsCommitted.add(totalChanges, createAttributes(this.metrics));
    this.metrics.queue?.documentsDeleted.add(totalChanges, createAttributes(this.metrics));

    // Periodic WAL checkpoint to prevent unbounded WAL growth
    // PASSIVE mode won't block - it just checkpoints what it can
    this.commitCount++;
    if (this.commitCount % WAL_CHECKPOINT_INTERVAL === 0) {
      try {
        this.db.exec('PRAGMA wal_checkpoint(PASSIVE);');
        this.logger.info('WAL checkpoint completed');
      } catch (error) {
        // Non-fatal - checkpoint will happen eventually
        this.logger.warn('WAL checkpoint failed', { error });
      }
    }
  }

  async requeue(documents: QueuedDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    const ids = documents.map((d) => parseInt(d.id.split('_').pop() || '0', 10));

    // Batch size for SQLite operations to avoid "too many SQL variables" error
    // SQLite default limit is usually 999 or 32766, so 500 is safe
    const BATCH_SIZE = 500;

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batchIds = ids.slice(i, i + BATCH_SIZE);

      const selectRetriesStmt = this.db.prepare(
        `SELECT id, retry_count FROM queue WHERE id IN (${batchIds.map(() => '?').join(',')})`
      );
      const rowsToRequeue = selectRetriesStmt.all(...batchIds) as { id: number; retry_count: number }[];

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
        this.logger.warn(`Requeued ${toRequeue.length} documents (batch ${Math.floor(i / BATCH_SIZE) + 1}).`);

        // Record requeue metrics
        this.metrics.queue?.documentsRequeued.add(toRequeue.length, createAttributes(this.metrics));
      }

      if (toFail.length > 0) {
        const failStmt = this.db.prepare(
          `UPDATE queue SET status = '${QUEUE_STATUS_FAILED}' WHERE id IN (${toFail.map(() => '?').join(',')})`
        );
        failStmt.run(...toFail);
        this.logger.error(
          `Moved ${toFail.length} documents to failed status after ${MAX_RETRIES} retries (batch ${Math.floor(i / BATCH_SIZE) + 1}).`
        );

        // Record failed metrics
        this.metrics.queue?.documentsFailed.add(toFail.length, createAttributes(this.metrics));
      }
    }
  }

  async requeueStaleTasks(): Promise<void> {
    this.logger.info('Checking for stale tasks...');

    // 1. Requeue items from dead workers (PIDs that are no longer running)
    // We do this by getting distinct PIDs first, checking liveness, and then batch updating
    const distinctPids = this.db
      .prepare(
        `
      SELECT DISTINCT worker_pid
      FROM queue
      WHERE status = ?
      AND worker_pid IS NOT NULL
    `
      )
      .all(QUEUE_STATUS_PROCESSING) as { worker_pid: number }[];

    const deadPids: number[] = [];
    for (const { worker_pid } of distinctPids) {
      if (!isProcessRunning(worker_pid)) {
        deadPids.push(worker_pid);
      }
    }

    if (deadPids.length > 0) {
      this.logger.warn(`Found ${deadPids.length} dead worker PIDs. Requeuing their tasks...`);
      const BATCH_SIZE = 500;
      for (let i = 0; i < deadPids.length; i += BATCH_SIZE) {
        const batchPids = deadPids.slice(i, i + BATCH_SIZE);
        const result = this.db
          .prepare(
            `
          UPDATE queue
          SET status = ?,
              processing_started_at = NULL,
              worker_pid = NULL
          WHERE status = ?
          AND worker_pid IN (${batchPids.map(() => '?').join(',')})
        `
          )
          .run(QUEUE_STATUS_PENDING, QUEUE_STATUS_PROCESSING, ...batchPids);
        this.logger.warn(
          `Requeued ${result.changes} tasks from dead workers (batch ${Math.floor(i / BATCH_SIZE) + 1}).`
        );
        this.metrics.queue?.documentsRequeued.add(
          result.changes,
          createAttributes(this.metrics, { reason: 'dead_worker' })
        );
      }
    }

    // 2. Requeue items that have timed out (stale timestamp), regardless of PID
    // This catches items with NULL PIDs (legacy) and items where the worker is alive but stuck
    const staleMinutes = Math.floor(STALE_TIMEOUT_MS / (60 * 1000));
    const staleWindow = `-${staleMinutes} minutes`;
    const result = this.db
      .prepare(
        `
      UPDATE queue
      SET status = ?,
          processing_started_at = NULL,
          worker_pid = NULL
      WHERE status = ?
      AND (
        processing_started_at IS NULL
        OR datetime(processing_started_at) IS NULL
        OR datetime(processing_started_at) < datetime('now', ?)
      )
    `
      )
      .run(QUEUE_STATUS_PENDING, QUEUE_STATUS_PROCESSING, staleWindow);

    if (result.changes > 0) {
      this.logger.warn(`Requeued ${result.changes} timed-out tasks.`);
      this.metrics.queue?.documentsRequeued.add(result.changes, createAttributes(this.metrics, { reason: 'timeout' }));
    }

    // Log total processing count for visibility
    const countResult = this.db
      .prepare('SELECT COUNT(*) as count FROM queue WHERE status = ?')
      .get(QUEUE_STATUS_PROCESSING) as { count: number };
    if (countResult.count > 0) {
      this.logger.info(`${countResult.count} tasks remain in processing state (active workers).`);
    } else {
      this.logger.info('No tasks in processing state.');
    }
  }

  /**
   * Clear all items from the queue (pending, processing, and failed)
   * Used when doing a clean reindex to start completely fresh
   */
  async clear(): Promise<void> {
    this.logger.info('Clearing queue (removing all items including failed)');
    const result = this.db.prepare('DELETE FROM queue').run();
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
