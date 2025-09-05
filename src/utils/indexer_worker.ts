import { IQueue, QueuedDocument } from './queue';
import { CodeChunk, indexCodeChunks } from './elasticsearch';
import { logger } from './logger';
import PQueue from 'p-queue';

const POLLING_INTERVAL_MS = 5000; // 5 seconds
const IDLE_TIMEOUT_MS = 30000; // 30 seconds

export class IndexerWorker {
  private queue: IQueue;
  private batchSize: number;
  private concurrency: number;
  private watch: boolean;
  private consumerQueue: PQueue;
  private isRunning = false;
  private idleTimer: NodeJS.Timeout | null = null;

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
    if (!this.watch) {
      this.resetIdleTimer();
    }
    this.pollQueue();
  }

  stop(): void {
    this.isRunning = false;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.consumerQueue.clear();
    logger.info('IndexerWorker stopping...');
  }

  private resetIdleTimer(): void {
    if (this.watch) {
      return; // Do not set a timeout in watch mode
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      logger.info('Worker has been idle for too long, stopping.');
      this.stop();
    }, IDLE_TIMEOUT_MS);
  }

  private async pollQueue(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      const documentBatch = await this.queue.dequeue(this.batchSize);

      if (documentBatch.length > 0) {
        if (!this.watch) this.resetIdleTimer();
        logger.info(`Dequeued batch of ${documentBatch.length} documents.`);
        this.consumerQueue.add(() => this.processBatch(documentBatch));
      }
    } catch (error) {
      logger.error('Error polling queue', { error });
    }

    if (this.isRunning) {
      setTimeout(() => this.pollQueue(), POLLING_INTERVAL_MS);
    }
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
