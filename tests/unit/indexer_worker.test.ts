import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IndexerWorker } from '../../src/utils/indexer_worker';
import { InMemoryQueue } from '../../src/utils/in_memory_queue';
import * as elasticsearch from '../../src/utils/elasticsearch';
import { CodeChunk, BulkIndexResult } from '../../src/utils/elasticsearch';
import { logger } from '../../src/utils/logger';

vi.mock('../../src/utils/elasticsearch', async () => {
  const actual = await vi.importActual('../../src/utils/elasticsearch');
  return {
    ...actual,
    indexCodeChunks: vi.fn(),
  };
});

// Helper to create a successful bulk result
const successResult = (chunks: CodeChunk[]): BulkIndexResult => ({
  succeeded: chunks,
  failed: [],
});

// Helper to create a failed bulk result
const failedResult = (chunks: CodeChunk[], error: unknown = { type: 'test_error' }): BulkIndexResult => ({
  succeeded: [],
  failed: chunks.map((chunk) => ({ chunk, error })),
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

    vi.mocked(elasticsearch.indexCodeChunks).mockResolvedValue(successResult([MOCK_CHUNK]));

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

    // Make indexing fail once, then succeed
    let callCount = 0;
    vi.mocked(elasticsearch.indexCodeChunks).mockImplementation(async (chunks) => {
      callCount++;
      if (callCount === 1) {
        return failedResult(chunks);
      }
      // On subsequent calls (after requeue), succeed to let worker finish
      return successResult(chunks);
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

    vi.mocked(elasticsearch.indexCodeChunks).mockImplementation(async (inputChunks) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      currentConcurrent--;
      return successResult(inputChunks);
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

    vi.mocked(elasticsearch.indexCodeChunks).mockImplementation(async (inputChunks) => {
      concurrentCount++;
      concurrencySnapshots.push(concurrentCount);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrentCount--;
      return successResult(inputChunks);
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
    vi.mocked(elasticsearch.indexCodeChunks).mockImplementation(async (chunks) => {
      callCount++;
      if (callCount === 1) {
        return failedResult(chunks, { type: 'mapper_parsing_exception' });
      }
      return successResult(chunks);
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
    vi.mocked(elasticsearch.indexCodeChunks).mockImplementation(async (chunks) => {
      return failedResult(chunks);
    });

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
    vi.mocked(elasticsearch.indexCodeChunks).mockImplementation(async (chunks) => {
      callCount++;
      if (callCount === 1) {
        return failedResult(chunks);
      }
      return successResult(chunks);
    });

    await concurrentWorker.start();

    expect(requeueSpy).toHaveBeenCalled();
    const requeuedDocs = requeueSpy.mock.calls[0][0];
    expect(requeuedDocs).toHaveLength(2);
  });

  // Partial failure - only failed docs requeued
  it('should only requeue failed documents on partial bulk failure', async () => {
    const goodChunk: CodeChunk = {
      ...MOCK_CHUNK,
      chunk_hash: 'good_chunk',
      content: 'const good = true;',
    };
    const badChunk: CodeChunk = {
      ...MOCK_CHUNK,
      chunk_hash: 'bad_chunk',
      content: 'const bad = false;',
    };

    concurrentWorker = new IndexerWorker({
      queue,
      batchSize: 10,
      concurrency: 1,
      watch: false,
      logger,
      elasticsearchIndex: testIndex,
    });

    await queue.enqueue([goodChunk, badChunk]);
    const requeueSpy = vi.spyOn(queue, 'requeue');
    const commitSpy = vi.spyOn(queue, 'commit');

    // First call: partial failure (good succeeds, bad fails)
    // Second call: bad chunk succeeds on retry
    let callCount = 0;
    vi.mocked(elasticsearch.indexCodeChunks).mockImplementation(async (chunks) => {
      callCount++;
      if (callCount === 1) {
        // Partial failure: good succeeds, bad fails
        return {
          succeeded: chunks.filter((c) => c.chunk_hash === 'good_chunk'),
          failed: chunks
            .filter((c) => c.chunk_hash === 'bad_chunk')
            .map((chunk) => ({ chunk, error: { type: 'mapper_parsing_exception' } })),
        };
      }
      // On retry, all succeed
      return successResult(chunks);
    });

    await concurrentWorker.start();

    // Good chunk should be committed immediately
    expect(commitSpy).toHaveBeenCalled();
    const firstCommit = commitSpy.mock.calls[0][0];
    expect(firstCommit).toHaveLength(1);
    expect(firstCommit[0].document.chunk_hash).toBe('good_chunk');

    // Only bad chunk should be requeued
    expect(requeueSpy).toHaveBeenCalled();
    const requeuedDocs = requeueSpy.mock.calls[0][0];
    expect(requeuedDocs).toHaveLength(1);
    expect(requeuedDocs[0].document.chunk_hash).toBe('bad_chunk');
  });
});
