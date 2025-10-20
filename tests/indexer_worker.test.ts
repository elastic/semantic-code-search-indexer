import { IndexerWorker } from '../src/utils/indexer_worker';
import { InMemoryQueue } from '../src/utils/in_memory_queue';
import * as elasticsearch from '../src/utils/elasticsearch';
import { CodeChunk } from '../src/utils/elasticsearch';
import { logger } from '../src/utils/logger';

// Mock the elasticsearch module
jest.mock('../src/utils/elasticsearch', () => ({
  ...jest.requireActual('../src/utils/elasticsearch'),
  indexCodeChunks: jest.fn(),
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
    jest.useFakeTimers();
    queue = new InMemoryQueue();
    // Use a very short polling interval for tests
    // Note: The worker's internal polling interval is hardcoded, so this test will rely on advancing timers.
    worker = new IndexerWorker({
      queue,
      batchSize: 10,
      concurrency: 1,
      watch: false,
      logger,
      elasticsearchIndex: testIndex,
    });
    (elasticsearch.indexCodeChunks as jest.Mock).mockClear();
  });

  afterEach(() => {
    worker.stop();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('should dequeue, process, and commit a batch', async () => {
    await queue.enqueue([MOCK_CHUNK]);
    const commitSpy = jest.spyOn(queue, 'commit');

    (elasticsearch.indexCodeChunks as jest.Mock).mockResolvedValue(undefined);

    worker.start();

    // Allow the worker's poll cycle to run
    await jest.advanceTimersByTimeAsync(10);

    // Wait for the processing to complete
    await worker.onIdle();

    expect(elasticsearch.indexCodeChunks).toHaveBeenCalledWith([MOCK_CHUNK], testIndex);
    expect(commitSpy).toHaveBeenCalled();
  });

  it('should requeue a batch if indexing fails', async () => {
    await queue.enqueue([MOCK_CHUNK]);
    const requeueSpy = jest.spyOn(queue, 'requeue');
    const commitSpy = jest.spyOn(queue, 'commit');

    (elasticsearch.indexCodeChunks as jest.Mock).mockRejectedValue(new Error('ES Error'));

    worker.start();

    // Allow the worker's poll cycle to run
    await jest.advanceTimersByTimeAsync(10);

    // Wait for the processing to complete
    await worker.onIdle();

    expect(elasticsearch.indexCodeChunks).toHaveBeenCalledWith([MOCK_CHUNK], testIndex);
    expect(requeueSpy).toHaveBeenCalled();
    expect(commitSpy).not.toHaveBeenCalled();
  });
});
