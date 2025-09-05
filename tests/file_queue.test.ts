import { vol } from 'memfs';
import { FileQueue } from '../src/utils/file_queue';
import { CodeChunk } from '../src/utils/elasticsearch';

// Mock the fs module to use memfs
jest.mock('fs', () => vol);

const MOCK_CHUNK_1: CodeChunk = {
  type: 'code',
  language: 'typescript',
  filePath: 'test1.ts',
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

describe('FileQueue', () => {
  const queueDir = '.test-queue';
  let queue: FileQueue;

  beforeEach(async () => {
    vol.reset(); // Clear the in-memory file system before each test
    queue = new FileQueue(queueDir);
    await queue.initialize();
  });

  it('should dequeue multiple files and aggregate documents', async () => {
    await queue.enqueue([MOCK_CHUNK_1]);
    await queue.enqueue([MOCK_CHUNK_2]);

    const dequeued = await queue.dequeue(2);
    
    expect(dequeued.length).toBe(2);
    expect(dequeued.map(d => d.document)).toEqual([MOCK_CHUNK_1, MOCK_CHUNK_2]);
    
    const pendingFiles = vol.readdirSync(`${queueDir}/pending`);
    expect(pendingFiles.length).toBe(0);

    const processingFiles = vol.readdirSync(`${queueDir}/processing`);
    expect(processingFiles.length).toBe(2);
  });

  it('should only dequeue up to the specified count', async () => {
    await queue.enqueue([MOCK_CHUNK_1]);
    await queue.enqueue([MOCK_CHUNK_2]);

    const dequeued = await queue.dequeue(1);
    
    expect(dequeued.length).toBe(1);
    expect(dequeued[0].document).toEqual(MOCK_CHUNK_1);
    
    const pendingFiles = vol.readdirSync(`${queueDir}/pending`);
    expect(pendingFiles.length).toBe(1);

    const processingFiles = vol.readdirSync(`${queueDir}/processing`);
    expect(processingFiles.length).toBe(1);
  });

  it('should commit multiple files', async () => {
    await queue.enqueue([MOCK_CHUNK_1]);
    await queue.enqueue([MOCK_CHUNK_2]);
    const dequeued = await queue.dequeue(2);
    await queue.commit(dequeued);

    const processingFiles = vol.readdirSync(`${queueDir}/processing`);
    expect(processingFiles.length).toBe(0);
  });

  it('should requeue multiple files', async () => {
    await queue.enqueue([MOCK_CHUNK_1]);
    await queue.enqueue([MOCK_CHUNK_2]);
    const dequeued = await queue.dequeue(2);
    await queue.requeue(dequeued);

    const processingFiles = vol.readdirSync(`${queueDir}/processing`);
    expect(processingFiles.length).toBe(0);

    const pendingFiles = vol.readdirSync(`${queueDir}/pending`);
    expect(pendingFiles.length).toBe(2);
    expect(pendingFiles[0]).toContain('_retry-1.json');
    expect(pendingFiles[1]).toContain('_retry-1.json');
  });
});