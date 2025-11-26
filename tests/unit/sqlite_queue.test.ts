import path from 'path';
import fs from 'fs';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';

import { SqliteQueue } from '../../src/utils/sqlite_queue';
import { CodeChunk } from '../../src/utils/elasticsearch';

/**
 * Test interface exposing private members of SqliteQueue for unit testing.
 * This is a standalone interface (not extending SqliteQueue) to avoid TS errors
 * about private property visibility.
 */
interface SqliteQueueTestable {
  statsCacheTime: number;
  cachedStats: { pending: number; processing: number; failed: number };
  getQueueStats(): { pending: number; processing: number; failed: number };
}

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

  it('should cache queue stats to prevent blocking event loop', async () => {
    // Add some documents to have non-zero stats
    await queue.enqueue([MOCK_CHUNK_1, MOCK_CHUNK_2]);

    // Cast to testable interface to access private members
    const testableQueue = queue as unknown as SqliteQueueTestable;

    // Initial cache time should be 0 (not yet populated)
    expect(testableQueue.statsCacheTime).toBe(0);

    // Call getQueueStats directly to populate cache (simulates OTEL callback)
    const stats1 = testableQueue.getQueueStats();
    const cacheTimeAfterFirstCall = testableQueue.statsCacheTime;

    // Cache should now be populated
    expect(cacheTimeAfterFirstCall).toBeGreaterThan(0);
    expect(stats1.pending).toBe(2); // Two documents enqueued

    // Cached stats should have correct structure
    const cachedStats = testableQueue.cachedStats;
    expect(cachedStats).toHaveProperty('pending');
    expect(cachedStats).toHaveProperty('processing');
    expect(cachedStats).toHaveProperty('failed');

    // Immediate second call should use cached value (cache time unchanged)
    const stats2 = testableQueue.getQueueStats();
    const cacheTimeAfterSecondCall = testableQueue.statsCacheTime;

    // Cache time should be the same since TTL hasn't expired
    expect(cacheTimeAfterSecondCall).toBe(cacheTimeAfterFirstCall);
    expect(stats2).toEqual(stats1);
  });

  it('should refresh stats cache after TTL expires', async () => {
    await queue.enqueue([MOCK_CHUNK_1]);

    // Cast to testable interface to access private members
    const testableQueue = queue as unknown as SqliteQueueTestable;

    // Trigger initial cache population by calling getQueueStats directly
    const initialStats = testableQueue.getQueueStats();
    expect(initialStats.pending).toBe(1);

    // Store the expired cache time we'll set
    const expiredCacheTime = Date.now() - 10000; // 10 seconds ago (TTL is 5s)
    testableQueue.statsCacheTime = expiredCacheTime;

    // Add another document
    await queue.enqueue([MOCK_CHUNK_2]);

    // Next getQueueStats call should refresh the cache since TTL expired
    const refreshedStats = testableQueue.getQueueStats();
    const refreshedCacheTime = testableQueue.statsCacheTime;

    // Cache time should be updated from the expired time to a fresh timestamp
    expect(refreshedCacheTime).toBeGreaterThan(expiredCacheTime);
    // Stats should reflect the new state (2 pending docs)
    expect(refreshedStats.pending).toBe(2);
  });

  it('should clear all items including failed documents', async () => {
    // Enqueue documents
    await queue.enqueue([MOCK_CHUNK_1, MOCK_CHUNK_2]);

    // Dequeue and requeue 3 times to move to failed status
    for (let i = 0; i < 3; i++) {
      const dequeued = await queue.dequeue(1);
      if (dequeued.length > 0) {
        await queue.requeue(dequeued);
      }
    }

    // Now we should have: 1 pending, 1 failed (after 3 retries)
    // Dequeue the remaining pending doc
    const remaining = await queue.dequeue(1);
    expect(remaining.length).toBe(1);

    // Clear the queue - should remove everything including failed
    await queue.clear();

    // Verify queue is completely empty
    const afterClear = await queue.dequeue(10);
    expect(afterClear.length).toBe(0);

    // Verify failed items are also gone by checking we can enqueue fresh
    await queue.enqueue([MOCK_CHUNK_1]);
    const fresh = await queue.dequeue(1);
    expect(fresh.length).toBe(1);
    expect(fresh[0].document.chunk_hash).toBe(MOCK_CHUNK_1.chunk_hash);
  });
});
