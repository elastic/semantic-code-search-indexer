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
          // If not in watch mode and the queue is empty, exit the loop.
          // The final `onIdle` will wait for any remaining tasks.
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

    try {
      const codeChunks = batch.map((item) => item.document);
      await indexCodeChunks(codeChunks, this.elasticsearchIndex);
      await this.queue.commit(batch);

      const duration = Date.now() - startTime;

      // Record successful batch metrics
      this.metrics.indexer?.batchProcessed.add(1, commonMetricAttributes);
      this.metrics.indexer?.batchDuration.record(duration, commonMetricAttributes);
      this.metrics.indexer?.batchSize.record(batch.length, commonMetricAttributes);

      this.logger.info(`Successfully indexed and committed batch of ${batch.length} documents.`);
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Record failed batch metrics
      this.metrics.indexer?.batchFailed.add(1, commonMetricAttributes);
      this.metrics.indexer?.batchDuration.record(duration, commonMetricAttributes);

      if (error instanceof Error) {
        this.logger.error('Error processing batch, requeueing.', {
          errorMessage: error.message,
          errorStack: error.stack,
        });
      } else {
        this.logger.error('An unknown error occurred while processing a batch.', { error });
      }
      await this.queue.requeue(batch);
      return false;
    }
  }

  async onIdle(): Promise<void> {
    return this.consumerQueue.onIdle();
  }
}
