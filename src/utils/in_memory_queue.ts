import { CodeChunk } from './elasticsearch';
import { IQueue, QueuedDocument } from './queue';
import { logger } from './logger';

const MAX_RETRIES = 3; // Match SqliteQueue behavior

interface InMemoryQueuedDocument extends QueuedDocument {
  retryCount: number;
}

/**
 * A simple in-memory queue for development and testing.
 * This is not persistent and is not suitable for production use where
 * resilience is required.
 *
 * Now includes retry limit matching SqliteQueue to prevent infinite loops.
 */
export class InMemoryQueue implements IQueue {
  private queue: InMemoryQueuedDocument[] = [];
  private enqueueCompleted = false;

  async enqueue(documents: CodeChunk[]): Promise<void> {
    const queuedDocs: InMemoryQueuedDocument[] = documents.map((doc) => ({
      id: doc.chunk_hash, // Using chunk_hash as ID
      document: doc,
      retryCount: 0,
    }));
    this.queue.push(...queuedDocs);
    logger.info(`Enqueued ${documents.length} documents. Queue size: ${this.queue.length}`);
    return Promise.resolve();
  }

  async dequeue(count: number): Promise<QueuedDocument[]> {
    const items = this.queue.splice(0, count);
    logger.info(`Dequeued ${items.length} documents. Remaining: ${this.queue.length}`);
    // Return as QueuedDocument[] (retryCount is not exposed in interface)
    return items;
  }

  async commit(documents: QueuedDocument[]): Promise<void> {
    // In a real queue, this would permanently delete the message.
    // For the in-memory version, dequeueing already removes it, so this is a no-op.
    logger.info(`Committed ${documents.length} documents.`);
    return Promise.resolve();
  }

  async requeue(documents: QueuedDocument[]): Promise<void> {
    // Filter out documents that have exceeded retry limit
    const docsToRequeue: InMemoryQueuedDocument[] = [];
    const docsFailed: QueuedDocument[] = [];

    for (const doc of documents) {
      // Cast to access retryCount (it exists on our internal type)
      const internalDoc = doc as InMemoryQueuedDocument;
      const currentRetryCount = internalDoc.retryCount;

      if (currentRetryCount + 1 >= MAX_RETRIES) {
        docsFailed.push(doc);
      } else {
        docsToRequeue.push({
          ...internalDoc,
          retryCount: currentRetryCount + 1,
        });
      }
    }

    if (docsFailed.length > 0) {
      logger.error(`${docsFailed.length} documents exceeded max retries (${MAX_RETRIES}) and will not be requeued.`, {
        failedIds: docsFailed.map((d) => d.id),
      });
    }

    if (docsToRequeue.length > 0) {
      // Add the documents back to the front of the queue for immediate retry.
      this.queue.unshift(...docsToRequeue);
      logger.warn(`Requeued ${docsToRequeue.length} documents. Queue size: ${this.queue.length}`);
    }

    return Promise.resolve();
  }

  async clear(): Promise<void> {
    const count = this.queue.length;
    this.queue = [];
    this.enqueueCompleted = false;
    logger.info(`Cleared ${count} items from in-memory queue`);
    return Promise.resolve();
  }

  async markEnqueueCompleted(): Promise<void> {
    this.enqueueCompleted = true;
    logger.info('Marked enqueue as completed (in-memory)');
    return Promise.resolve();
  }

  isEnqueueCompleted(): boolean {
    return this.enqueueCompleted;
  }
}
