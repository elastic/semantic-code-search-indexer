import { IQueue, QueuedDocument } from './queue';
import { CodeChunk, indexCodeChunks } from './elasticsearch';
import { logger } from './logger';
import PQueue from 'p-queue';
import { SqliteQueue } from './sqlite_queue';

const POLLING_INTERVAL_MS = 1000; // 1 second

export class IndexerWorker {
  private queue: IQueue;
  private batchSize: number;
  private concurrency: number;
  private watch: boolean;
  private consumerQueue: PQueue;
  private isRunning = false;

  constructor(queue: IQueue, batchSize: number, concurrency: number = 1, watch: boolean = false) {
    this.queue = queue;
    this.batchSize = batchSize;
    this.concurrency = concurrency;
    this.watch = watch;
    this.consumerQueue = new PQueue({ concurrency: this.concurrency });
  }

  async start(): Promise<void> {
    this.isRunning = true;
    logger.info('IndexerWorker started', { concurrency: this.concurrency, batchSize: this.batchSize, watch: this.watch });

    if (this.queue instanceof SqliteQueue) {
        await this.queue.requeueStaleTasks();
    }

    while (this.isRunning) {
        const documentBatch = await this.queue.dequeue(this.batchSize);

        if (documentBatch.length > 0) {
            logger.info(`Dequeued batch of ${documentBatch.length} documents.`);
            // By awaiting here, we apply backpressure. The loop will not fetch the next batch
            // until the current one is fully processed and committed.
            await this.consumerQueue.add(() => this.processBatch(documentBatch));
        } else {
            if (this.watch) {
                // If in watch mode and the queue is empty, wait before polling again.
                await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
            } else {
                // If not in watch mode and the queue is empty, we are done.
                this.stop();
            }
        }
    }
    
    // Wait for any final in-flight tasks to complete before exiting.
    await this.consumerQueue.onIdle();
    logger.info('IndexerWorker finished processing all tasks.');
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;
    logger.info('IndexerWorker stopping...');
  }

  private async processBatch(batch: QueuedDocument[]): Promise<void> {
    try {
      const codeChunks = batch.map(item => item.document);
      await indexCodeChunks(codeChunks);
      await this.queue.commit(batch);
      logger.info(`Successfully indexed and committed batch of ${batch.length} documents.`);
    } catch (error) {
      logger.error('Error processing batch, requeueing.', { error });
      await this.queue.requeue(batch);
    }
  }

  async onIdle(): Promise<void> {
    return this.consumerQueue.onIdle();
  }
}
