import { IQueue, QueuedDocument } from './queue';
import { indexCodeChunks } from './elasticsearch';
import { logger as defaultLogger, createLogger } from './logger';
import PQueue from 'p-queue';
import { SqliteQueue } from './sqlite_queue';
import { createMetrics, Metrics, createAttributes } from './metrics';

const POLLING_INTERVAL_MS = 1000; // 1 second

type Logger = ReturnType<typeof createLogger>;

export interface IndexerWorkerOptions {
  queue: IQueue;
  batchSize: number;
  concurrency?: number;
  watch?: boolean;
  logger?: Logger;
  elasticsearchIndex?: string;
  repoInfo?: { name: string; branch: string };
}

export class IndexerWorker {
  private queue: IQueue;
  private batchSize: number;
  private concurrency: number;
  private watch: boolean;
  private consumerQueue: PQueue;
  private isRunning = false;
  private elasticsearchIndex?: string;
  private logger: Logger;
  private metrics: Metrics;

  constructor(options: IndexerWorkerOptions) {
    this.queue = options.queue;
    this.batchSize = options.batchSize;
    this.concurrency = options.concurrency ?? 1;
    this.watch = options.watch ?? false;
    this.consumerQueue = new PQueue({ concurrency: this.concurrency });
    this.elasticsearchIndex = options.elasticsearchIndex;
    this.logger = options.logger ?? defaultLogger;
    this.metrics = createMetrics(options.repoInfo);
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.logger.info('IndexerWorker started', {
      concurrency: this.concurrency,
      batchSize: this.batchSize,
      watch: this.watch,
    });

    if (this.queue instanceof SqliteQueue) {
      await this.queue.requeueStaleTasks();
    }

    while (this.isRunning) {
      // Backpressure: Only dequeue a new batch if we have a free worker slot.
      // Check both pending (waiting) and active (running) tasks
      const totalActiveTasks = this.consumerQueue.size + this.consumerQueue.pending;
      if (totalActiveTasks >= this.concurrency) {
        // Wait for the next task to complete, which signals a slot is free.
        await new Promise<void>((resolve) => this.consumerQueue.once('next', resolve));
        continue;
      }

      const documentBatch = await this.queue.dequeue(this.batchSize);

      if (documentBatch.length > 0) {
        this.logger.info(`Dequeued batch of ${documentBatch.length} documents. Active tasks: ${totalActiveTasks + 1}`);
        // Add the task to the queue. Do not await.
        // p-queue will manage running it concurrently.
        this.consumerQueue.add(() => this.processBatch(documentBatch));
      } else {
        if (this.watch) {
          // If in watch mode and the queue is empty, wait before polling again.
          await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
        } else {
          // If not in watch mode and dequeue returns empty:
          // - If there are still in-flight tasks, wait for a task to complete and retry.
          //   (In-flight tasks may requeue work back to 'pending' when they finish.)
          // - If there are no in-flight tasks, we're truly done.
          if (totalActiveTasks > 0) {
            await new Promise<void>((resolve) => this.consumerQueue.once('next', resolve));
            continue;
          }
          break;
        }
      }
    }

    // Wait for any final in-flight tasks to complete before exiting.
    await this.consumerQueue.onIdle();
    this.logger.info('IndexerWorker finished processing all tasks.');
    this.stop();
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;
    this.logger.info('IndexerWorker stopping...');
  }

  private async processBatch(batch: QueuedDocument[]): Promise<boolean> {
    const startTime = Date.now();
    const commonMetricAttributes = createAttributes(this.metrics, {
      concurrency: this.concurrency.toString(),
    });

    let committed: QueuedDocument[] = [];
    let requeued: QueuedDocument[] = [];

    try {
      const codeChunks = batch.map((item) => item.document);
      const result = await indexCodeChunks(codeChunks, this.elasticsearchIndex);

      const duration = Date.now() - startTime;

      // Map indexCodeChunks results back to the exact queue rows by input index.
      // Do NOT map by chunk_hash: chunk_hash is not guaranteed unique (content collisions),
      // and duplicates would leave rows stuck in 'processing'.
      const succeededDocs = result.succeeded
        .map((s) => batch[s.inputIndex])
        .filter((doc): doc is QueuedDocument => doc !== undefined);

      const failedDocs = result.failed
        .map((f) => batch[f.inputIndex])
        .filter((doc): doc is QueuedDocument => doc !== undefined);

      // Commit succeeded documents
      if (succeededDocs.length > 0) {
        await this.queue.commit(succeededDocs);
        committed = succeededDocs;
      }

      // Requeue failed documents
      if (failedDocs.length > 0) {
        await this.queue.requeue(failedDocs);
        requeued = failedDocs;
        this.logger.error(`Requeueing ${failedDocs.length} failed documents from batch of ${batch.length}.`);
      }

      // Record metrics
      if (result.failed.length === 0) {
        // Full success
        this.metrics.indexer?.batchProcessed.add(1, commonMetricAttributes);
        this.metrics.indexer?.batchDuration.record(duration, commonMetricAttributes);
        this.metrics.indexer?.batchSize.record(batch.length, commonMetricAttributes);
        this.logger.info(`Successfully indexed and committed batch of ${succeededDocs.length} documents.`);
        return true;
      } else if (result.succeeded.length > 0) {
        // Partial success
        this.metrics.indexer?.batchProcessed.add(1, commonMetricAttributes);
        this.metrics.indexer?.batchDuration.record(duration, commonMetricAttributes);
        this.metrics.indexer?.batchSize.record(succeededDocs.length, commonMetricAttributes);
        this.logger.info(
          `Partial success: ${succeededDocs.length}/${batch.length} indexed, ${failedDocs.length} failed.`
        );
        return true;
      } else {
        // Complete failure
        this.metrics.indexer?.batchFailed.add(1, commonMetricAttributes);
        this.metrics.indexer?.batchDuration.record(duration, commonMetricAttributes);
        this.logger.error(`Complete batch failure: all ${batch.length} documents failed.`);
        return false;
      }
    } catch (error) {
      // Critical safety: never leave dequeued rows stuck in 'processing' due to an exception.
      // Best-effort requeue any documents that were not already committed or requeued.
      const committedIds = new Set(committed.map((d) => d.id));
      const requeuedIds = new Set(requeued.map((d) => d.id));
      const remaining = batch.filter((d) => !committedIds.has(d.id) && !requeuedIds.has(d.id));

      this.logger.error('processBatch threw; attempting to requeue remaining documents', {
        error: error instanceof Error ? error.message : String(error),
        batchSize: batch.length,
        remaining: remaining.length,
      });

      if (remaining.length > 0) {
        try {
          await this.queue.requeue(remaining);
          this.logger.warn(`Requeued ${remaining.length} documents after exception.`);
        } catch (requeueError) {
          this.logger.error('Failed to requeue documents after exception; they may remain stuck until stale recovery', {
            error: requeueError instanceof Error ? requeueError.message : String(requeueError),
          });
        }
      }

      this.metrics.indexer?.batchFailed.add(1, commonMetricAttributes);
      return false;
    }
  }

  async onIdle(): Promise<void> {
    return this.consumerQueue.onIdle();
  }
}
