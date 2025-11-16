import { CodeChunk } from './elasticsearch';
import { IQueue, QueuedDocument } from './queue';
import { logger } from './logger';

/**
 * A simple in-memory queue for development and testing.
 * This is not persistent and is not suitable for production use where
 * resilience is required.
 */
export class InMemoryQueue implements IQueue {
  private queue: CodeChunk[] = [];

  async enqueue(documents: CodeChunk[]): Promise<void> {
    this.queue.push(...documents);
    logger.info(`Enqueued ${documents.length} documents. Queue size: ${this.queue.length}`);
    return Promise.resolve();
  }

  async dequeue(count: number): Promise<QueuedDocument[]> {
    const items = this.queue.splice(0, count);
    return Promise.resolve(
      items.map((doc) => ({
        id: doc.chunk_hash, // Using chunk_hash as a mock message ID
        document: doc,
      }))
    );
  }

  async commit(documents: QueuedDocument[]): Promise<void> {
    // In a real queue, this would permanently delete the message.
    // For the in-memory version, dequeueing already removes it, so this is a no-op.
    logger.info(`Committed ${documents.length} documents.`);
    return Promise.resolve();
  }

  async requeue(documents: QueuedDocument[]): Promise<void> {
    // Add the documents back to the front of the queue for immediate retry.
    const originalDocs = documents.map((d) => d.document);
    this.queue.unshift(...originalDocs);
    logger.warn(`Requeued ${documents.length} documents. Queue size: ${this.queue.length}`);
    return Promise.resolve();
  }

  async clear(): Promise<void> {
    const count = this.queue.length;
    this.queue = [];
    this.enqueueCompleted = false;
    logger.info(`Cleared ${count} items from in-memory queue`);
    return Promise.resolve();
  }

  private enqueueCompleted = false;

  async markEnqueueCompleted(): Promise<void> {
    this.enqueueCompleted = true;
    logger.info('Marked enqueue as completed (in-memory)');
    return Promise.resolve();
  }

  isEnqueueCompleted(): boolean {
    return this.enqueueCompleted;
  }
}
