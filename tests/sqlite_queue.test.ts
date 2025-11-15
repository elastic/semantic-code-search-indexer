import { SqliteQueue } from '../src/utils/sqlite_queue';
import { CodeChunk } from '../src/utils/elasticsearch';
import path from 'path';
import fs from 'fs';

const MOCK_CHUNK_1: CodeChunk = {
  type: 'code',
  language: 'typescript',
  filePath: 'test1.ts',
  directoryPath: '',
  directoryName: '',
  directoryDepth: 0,
  git_file_hash: 'hash1',
  git_branch: 'main',
  chunk_hash: 'chunk_hash_1',
  startLine: 1,
  endLine: 1,
  content: 'const a = 1;',
  semantic_text: 'const a = 1;',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const MOCK_CHUNK_2: CodeChunk = {
  type: 'code',
  language: 'typescript',
  filePath: 'test2.ts',
  directoryPath: '',
  directoryName: '',
  directoryDepth: 0,
  git_file_hash: 'hash2',
  git_branch: 'main',
  chunk_hash: 'chunk_hash_2',
  startLine: 1,
  endLine: 1,
  content: 'const b = 2;',
  semantic_text: 'const b = 2;',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('SqliteQueue', () => {
  const queueDir = '.test-queue';
  const dbPath = path.join(queueDir, 'queue.db');
  let queue: SqliteQueue;

  beforeEach(async () => {
    if (fs.existsSync(queueDir)) {
      fs.rmSync(queueDir, { recursive: true, force: true });
    }
    fs.mkdirSync(queueDir, { recursive: true });
    queue = new SqliteQueue({ dbPath });
    await queue.initialize();
  });

  afterEach(() => {
    queue.close();
    if (fs.existsSync(queueDir)) {
      fs.rmSync(queueDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    // No need to close here as it's handled in afterEach
  });

  it('should dequeue multiple documents', async () => {
    await queue.enqueue([MOCK_CHUNK_1, MOCK_CHUNK_2]);

    const dequeued = await queue.dequeue(2);

    expect(dequeued.length).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { created_at: _c1, updated_at: _u1, ...chunk1 } = MOCK_CHUNK_1;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { created_at: _c2, updated_at: _u2, ...chunk2 } = MOCK_CHUNK_2;
    expect(dequeued.map((d) => d.document)).toEqual([MOCK_CHUNK_1, MOCK_CHUNK_2]);
  });

  it('should only dequeue up to the specified count', async () => {
    await queue.enqueue([MOCK_CHUNK_1]);
    await queue.enqueue([MOCK_CHUNK_2]);

    const dequeued = await queue.dequeue(1);

    expect(dequeued.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { created_at: _c1, updated_at: _u1, ...chunk1 } = MOCK_CHUNK_1;
    expect(dequeued[0].document).toEqual(MOCK_CHUNK_1);
  });

  it('should commit multiple documents', async () => {
    await queue.enqueue([MOCK_CHUNK_1, MOCK_CHUNK_2]);
    const dequeued = await queue.dequeue(2);
    await queue.commit(dequeued);

    const remaining = await queue.dequeue(2);
    expect(remaining.length).toBe(0);
  });

  it('should requeue multiple documents', async () => {
    await queue.enqueue([MOCK_CHUNK_1, MOCK_CHUNK_2]);
    const dequeued = await queue.dequeue(2);
    await queue.requeue(dequeued);

    const requeued = await queue.dequeue(2);
    expect(requeued.length).toBe(2);
  });

  it('should create a queue with repository context', async () => {
    const contextQueue = new SqliteQueue({
      dbPath: path.join(queueDir, 'context-queue.db'),
      repoName: 'test-repo',
      branch: 'main',
    });
    await contextQueue.initialize();

    // Verify queue operations work correctly with context
    await contextQueue.enqueue([MOCK_CHUNK_1]);
    const dequeued = await contextQueue.dequeue(1);
    expect(dequeued.length).toBe(1);

    contextQueue.close();
  });

  it('should create a queue without repository context (backward compatibility)', async () => {
    const noContextQueue = new SqliteQueue({ dbPath: path.join(queueDir, 'no-context-queue.db') });
    await noContextQueue.initialize();

    // Verify queue operations work correctly without context
    await noContextQueue.enqueue([MOCK_CHUNK_1]);
    const dequeued = await noContextQueue.dequeue(1);
    expect(dequeued.length).toBe(1);

    noContextQueue.close();
  });

  it('should move documents to failed status after MAX_RETRIES', async () => {
    await queue.enqueue([MOCK_CHUNK_1]);

    // Simulate MAX_RETRIES (3) requeue attempts
    for (let i = 0; i < 3; i++) {
      const dequeued = await queue.dequeue(1);
      expect(dequeued.length).toBe(1);
      await queue.requeue(dequeued);
    }

    // After 3 requeues, documents should be in failed status and not dequeued
    const shouldBeEmpty = await queue.dequeue(1);
    expect(shouldBeEmpty.length).toBe(0);
  });

  it('should increment retry_count on each requeue', async () => {
    await queue.enqueue([MOCK_CHUNK_1]);

    // First attempt
    const dequeued1 = await queue.dequeue(1);
    expect(dequeued1.length).toBe(1);
    await queue.requeue(dequeued1);

    // Second attempt - should still be available
    const dequeued2 = await queue.dequeue(1);
    expect(dequeued2.length).toBe(1);
    await queue.requeue(dequeued2);

    // Third attempt - should still be available
    const dequeued3 = await queue.dequeue(1);
    expect(dequeued3.length).toBe(1);
  });
});
