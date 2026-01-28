import { CodeChunk } from './elasticsearch';

export interface QueuedDocument {
  id: string;
  document: CodeChunk;
}

export interface IQueue {
  enqueue(documents: CodeChunk[]): Promise<void>;
  dequeue(count: number): Promise<QueuedDocument[]>;
  commit(documents: QueuedDocument[]): Promise<void>;
  requeue(documents: QueuedDocument[]): Promise<void>;
  clear(): Promise<void>;
  markEnqueueCompleted(): Promise<void>;
  isEnqueueCompleted(): boolean;
}

/**
 * Optional queue metadata used to safely resume indexing runs.
 *
 * This metadata allows the index command to distinguish "enqueue was interrupted"
 * from a normal resume, and to catch up when the repository HEAD advances between runs.
 */
export interface IQueueWithEnqueueMetadata extends IQueue {
  markEnqueueStarted(): Promise<void>;
  setEnqueueCommitHash(commitHash: string): Promise<void>;
  getEnqueueCommitHash(): string | null;
}
