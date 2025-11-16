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
