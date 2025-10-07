import { IQueue, QueuedDocument } from './queue';
import { CodeChunk, indexCodeChunks } from './elasticsearch';
import { logger as defaultLogger, createLogger } from './logger';
import PQueue from 'p-queue';
import { SqliteQueue } from './sqlite_queue';

const POLLING_INTERVAL_MS = 1000; // 1 second

type Logger = ReturnType<typeof createLogger>;

export class IndexerWorker {
  private queue: IQueue;
  private batchSize: number;
  private concurrency: number;
  private watch: boolean;
  private consumerQueue: PQueue;
  private isRunning = false;
  private elasticsearchIndex?: string;
  private logger: Logger;

  constructor(
    queue: IQueue,
    batchSize: number,
    concurrency: number = 1,
    watch: boolean = false,
    logger: Logger = defaultLogger,
    elasticsearchIndex?: string
  ) {
    this.queue = queue;
    this.batchSize = batchSize;
    this.concurrency = concurrency;
    this.watch = watch;
    this.consumerQueue = new PQueue({ concurrency: this.concurrency });
    this.elasticsearchIndex = elasticsearchIndex;
    this.logger = logger;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.logger.info('IndexerWorker started', { concurrency: this.concurrency, batchSize: this.batchSize, watch: this.watch });

    if (this.queue instanceof SqliteQueue) {
        await this.queue.requeueStaleTasks();
    }

    while (this.isRunning) {
        // Backpressure: Only dequeue a new batch if we have a free worker slot.
        if (this.consumerQueue.size >= this.concurrency) {
            // Wait for the next task to complete, which signals a slot is free.
            await new Promise(resolve => this.consumerQueue.once('next', resolve));
            continue;
        }

        const documentBatch = await this.queue.dequeue(this.batchSize);

        if (documentBatch.length > 0) {
            this.logger.info(`Dequeued batch of ${documentBatch.length} documents. Active tasks: ${this.consumerQueue.size + 1}`);
            // Add the task to the queue. Do not await.
            // p-queue will manage running it concurrently.
            this.consumerQueue.add(() => this.processBatch(documentBatch));
        } else {
            if (this.watch) {
                // If in watch mode and the queue is empty, wait before polling again.
                await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
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
    try {
      const codeChunks = batch.map(item => item.document);
      await indexCodeChunks(codeChunks, this.elasticsearchIndex);
      await this.queue.commit(batch);
      this.logger.info(`Successfully indexed and committed batch of ${batch.length} documents.`);
      return true;
    } catch (error) {
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