import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IndexerWorker } from '../../src/utils/indexer_worker';
import { InMemoryQueue } from '../../src/utils/in_memory_queue';
import * as elasticsearch from '../../src/utils/elasticsearch';
import { CodeChunk } from '../../src/utils/elasticsearch';
import { logger } from '../../src/utils/logger';

vi.mock('../../src/utils/elasticsearch', async () => {
  const actual = await vi.importActual('../../src/utils/elasticsearch');
  return {
    ...actual,
    indexCodeChunks: vi.fn(),
  };
});

const MOCK_CHUNK: CodeChunk = {
  type: 'code',
  language: 'typescript',
  filePath: 'test.ts',
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

describe('IndexerWorker', () => {
  let queue: InMemoryQueue;
  let concurrentWorker: IndexerWorker;
  const testIndex = 'test-index';

  beforeEach(() => {
    vi.useRealTimers();
    queue = new InMemoryQueue();
    vi.mocked(elasticsearch.indexCodeChunks).mockClear();
  });

  afterEach(() => {
    if (concurrentWorker) {
      concurrentWorker.stop();
    }
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // Test 1: Basic functionality - dequeue, process, commit
  it('should dequeue, process, and commit a batch', async () => {
    concurrentWorker = new IndexerWorker({
      queue,
      batchSize: 10,
      concurrency: 1,
      watch: false,
      logger,
      elasticsearchIndex: testIndex,
    });

    await queue.enqueue([MOCK_CHUNK]);
    const commitSpy = vi.spyOn(queue, 'commit');

    vi.mocked(elasticsearch.indexCodeChunks).mockResolvedValue(undefined);

    await concurrentWorker.start();

    expect(elasticsearch.indexCodeChunks).toHaveBeenCalledWith([MOCK_CHUNK], testIndex);
    expect(commitSpy).toHaveBeenCalled();
  });

  // Test 2: Error handling - requeue on failure
  it('should requeue a batch if indexing fails', async () => {
    concurrentWorker = new IndexerWorker({
      queue,
      batchSize: 10,
      concurrency: 1,
      watch: false,
      logger,
      elasticsearchIndex: testIndex,
    });

    await queue.enqueue([MOCK_CHUNK]);
    const requeueSpy = vi.spyOn(queue, 'requeue');
    const commitSpy = vi.spyOn(queue, 'commit');

    // Make indexing fail once, then stop the worker to prevent infinite loop
    let callCount = 0;
    vi.mocked(elasticsearch.indexCodeChunks).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('ES Error');
      }
      // On subsequent calls (after requeue), succeed to let worker finish
      return undefined;
    });

    await concurrentWorker.start();

    expect(elasticsearch.indexCodeChunks).toHaveBeenCalled();
    expect(requeueSpy).toHaveBeenCalled();
    // First attempt fails and requeues, second attempt succeeds and commits
    expect(commitSpy).toHaveBeenCalled();
  });

  it('should respect concurrency limit with slow ES responses', async () => {
    concurrentWorker = new IndexerWorker({
      queue,
      batchSize: 1,
      concurrency: 2,
      watch: false,
      logger,
      elasticsearchIndex: testIndex,
    });

    const chunks = Array.from({ length: 5 }, (_, i) => ({
      ...MOCK_CHUNK,
      chunk_hash: `chunk_${i}`,
    }));
    await queue.enqueue(chunks);

    let currentConcurrent = 0;
    let maxConcurrent = 0;

    vi.mocked(elasticsearch.indexCodeChunks).mockImplementation(async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      currentConcurrent--;
    });

    await concurrentWorker.start();

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(maxConcurrent).toBeGreaterThan(0);
    expect(elasticsearch.indexCodeChunks).toHaveBeenCalledTimes(5);
  });

  it('should not over-dequeue when tasks are running (size + pending check)', async () => {
    concurrentWorker = new IndexerWorker({
      queue,
      batchSize: 1,
      concurrency: 2,
      watch: false,
      logger,
      elasticsearchIndex: testIndex,
    });

    const chunks = Array.from({ length: 4 }, (_, i) => ({
      ...MOCK_CHUNK,
      chunk_hash: `chunk_${i}`,
    }));
    await queue.enqueue(chunks);

    let concurrentCount = 0;
    const concurrencySnapshots: number[] = [];

    vi.mocked(elasticsearch.indexCodeChunks).mockImplementation(async () => {
      concurrentCount++;
      concurrencySnapshots.push(concurrentCount);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrentCount--;
    });

    await concurrentWorker.start();

    concurrencySnapshots.forEach((snapshot) => {
      expect(snapshot).toBeLessThanOrEqual(2);
    });
    expect(elasticsearch.indexCodeChunks).toHaveBeenCalledTimes(4);
  });

  // Test 3: Bulk indexing failures
  it('should requeue batch when Elasticsearch bulk indexing fails', async () => {
    concurrentWorker = new IndexerWorker({
      queue,
      batchSize: 10,
      concurrency: 1,
      watch: false,
      logger,
      elasticsearchIndex: testIndex,
    });

    await queue.enqueue([MOCK_CHUNK]);
    const requeueSpy = vi.spyOn(queue, 'requeue');
    const commitSpy = vi.spyOn(queue, 'commit');

    // Make it fail once, then succeed
    let callCount = 0;
    vi.mocked(elasticsearch.indexCodeChunks).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error(
          'Bulk indexing failed: 1 of 1 documents had errors. First error: {"type":"mapper_parsing_exception"}'
        );
      }
      return undefined;
    });

    await concurrentWorker.start();

    expect(requeueSpy).toHaveBeenCalled();
    const requeuedDocs = requeueSpy.mock.calls[0][0];
    expect(requeuedDocs).toHaveLength(1);
    expect(requeuedDocs[0].document.chunk_hash).toBe(MOCK_CHUNK.chunk_hash);
    // After requeue, it succeeds
    expect(commitSpy).toHaveBeenCalled();
  });

  // Test 4: Retry limit enforcement
  it('should stop retrying after max retries (3 attempts)', async () => {
    concurrentWorker = new IndexerWorker({
      queue,
      batchSize: 10,
      concurrency: 1,
      watch: false,
      logger,
      elasticsearchIndex: testIndex,
    });

    await queue.enqueue([MOCK_CHUNK]);
    const commitSpy = vi.spyOn(queue, 'commit');
    const requeueSpy = vi.spyOn(queue, 'requeue');

    // Always fail to test retry limit
    vi.mocked(elasticsearch.indexCodeChunks).mockRejectedValue(
      new Error('Bulk indexing failed: 1 of 1 documents had errors')
    );

    await concurrentWorker.start();

    // Should have tried 3 times (initial + 2 retries), then given up
    expect(elasticsearch.indexCodeChunks).toHaveBeenCalledTimes(3);
    expect(requeueSpy).toHaveBeenCalledTimes(3);
    // After max retries, document is dropped, so no commit
    expect(commitSpy).not.toHaveBeenCalled();
  });

  // Test 5: Multiple document failures
  it('should handle multiple document failures correctly', async () => {
    const mockChunk2: CodeChunk = {
      ...MOCK_CHUNK,
      chunk_hash: 'chunk_hash_2',
      content: 'const b = 2;',
    };

    concurrentWorker = new IndexerWorker({
      queue,
      batchSize: 10,
      concurrency: 1,
      watch: false,
      logger,
      elasticsearchIndex: testIndex,
    });

    await queue.enqueue([MOCK_CHUNK, mockChunk2]);
    const requeueSpy = vi.spyOn(queue, 'requeue');

    // Fail once, then succeed
    let callCount = 0;
    vi.mocked(elasticsearch.indexCodeChunks).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Bulk indexing failed: 2 of 2 documents had errors');
      }
      return undefined;
    });

    await concurrentWorker.start();

    expect(requeueSpy).toHaveBeenCalled();
    const requeuedDocs = requeueSpy.mock.calls[0][0];
    expect(requeuedDocs).toHaveLength(2);
  });
});
