import { IndexerWorker } from '../src/utils/indexer_worker';
import { InMemoryQueue } from '../src/utils/in_memory_queue';
import * as elasticsearch from '../src/utils/elasticsearch';
import { CodeChunk } from '../src/utils/elasticsearch';
import { logger } from '../src/utils/logger';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

// Mock the elasticsearch module
vi.mock('../src/utils/elasticsearch', async () => ({
  ...((await vi.importActual('../src/utils/elasticsearch')) as object),
  indexCodeChunks: vi.fn(),
}));

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
  let worker: IndexerWorker;
  const testIndex = 'test-index';

  beforeEach(() => {
    queue = new InMemoryQueue();
    worker = new IndexerWorker({
      queue,
      batchSize: 10,
      concurrency: 1,
      watch: false,
      logger,
      elasticsearchIndex: testIndex,
    });
  });

  afterEach(() => {
    worker.stop();
  });

  it('should dequeue, process, and commit a batch', async () => {
    await queue.enqueue([MOCK_CHUNK]);
    const commitSpy = vi.spyOn(queue, 'commit');

    vi.mocked(elasticsearch.indexCodeChunks).mockResolvedValue(undefined);

    const workerPromise = worker.start();
    await worker.onIdle();

    expect(elasticsearch.indexCodeChunks).toHaveBeenCalledWith([MOCK_CHUNK], testIndex);
    expect(commitSpy).toHaveBeenCalled();

    await workerPromise;
  });

  it('should requeue a batch if indexing fails', async () => {
    await queue.enqueue([MOCK_CHUNK]);
    const requeueSpy = vi.spyOn(queue, 'requeue');
    const commitSpy = vi.spyOn(queue, 'commit');

    vi.mocked(elasticsearch.indexCodeChunks).mockRejectedValue(new Error('ES Error'));

    const workerPromise = worker.start();
    await worker.onIdle();

    expect(elasticsearch.indexCodeChunks).toHaveBeenCalledWith([MOCK_CHUNK], testIndex);
    expect(requeueSpy).toHaveBeenCalled();
    expect(commitSpy).not.toHaveBeenCalled();

    await workerPromise;
  });

  it('should requeue batch when Elasticsearch bulk indexing fails', async () => {
    await queue.enqueue([MOCK_CHUNK]);
    const requeueSpy = vi.spyOn(queue, 'requeue');
    const commitSpy = vi.spyOn(queue, 'commit');

    vi.mocked(elasticsearch.indexCodeChunks).mockRejectedValue(
      new Error('Bulk indexing failed: 1 of 1 documents had errors. First error: {"type":"mapper_parsing_exception"}')
    );

    const workerPromise = worker.start();
    await worker.onIdle();

    expect(requeueSpy).toHaveBeenCalled();
    expect(commitSpy).not.toHaveBeenCalled();

    const requeuedDocs = requeueSpy.mock.calls[0][0];
    expect(requeuedDocs).toHaveLength(1);
    expect(requeuedDocs[0].document.chunk_hash).toBe(MOCK_CHUNK.chunk_hash);

    await workerPromise;
  });

  it('should not commit documents when bulk indexing fails', async () => {
    await queue.enqueue([MOCK_CHUNK]);
    const commitSpy = vi.spyOn(queue, 'commit');

    vi.mocked(elasticsearch.indexCodeChunks).mockRejectedValue(
      new Error('Bulk indexing failed: 1 of 1 documents had errors')
    );

    const workerPromise = worker.start();
    await worker.onIdle();

    expect(commitSpy).not.toHaveBeenCalled();

    await workerPromise;
  });

  it('should handle multiple document failures correctly', async () => {
    const mockChunk2: CodeChunk = {
      ...MOCK_CHUNK,
      chunk_hash: 'chunk_hash_2',
      content: 'const b = 2;',
    };

    await queue.enqueue([MOCK_CHUNK, mockChunk2]);
    const requeueSpy = vi.spyOn(queue, 'requeue');

    vi.mocked(elasticsearch.indexCodeChunks).mockRejectedValue(
      new Error('Bulk indexing failed: 2 of 2 documents had errors')
    );

    const workerPromise = worker.start();
    await worker.onIdle();

    expect(requeueSpy).toHaveBeenCalled();
    const requeuedDocs = requeueSpy.mock.calls[0][0];
    expect(requeuedDocs).toHaveLength(2);

    await workerPromise;
  });
});
