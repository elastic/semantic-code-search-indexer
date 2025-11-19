import { SqliteQueue } from '../src/utils/sqlite_queue';
import { CodeChunk } from '../src/utils/elasticsearch';
import path from 'path';
import fs from 'fs';

describe('Enqueue Completion Tracking', () => {
  const testQueueDir = path.join(__dirname, '.test-enqueue-resume');
  const queueDbPath = path.join(testQueueDir, 'queue.db');
  let queue: SqliteQueue;

  const createMockChunk = (id: number): CodeChunk => ({
    type: 'code',
    language: 'typescript',
    filePath: `/test/file${id}.ts`,
    directoryPath: '/test',
    directoryName: 'test',
    directoryDepth: 1,
    git_file_hash: `hash${id}`,
    git_branch: 'main',
    chunk_hash: `chunk-hash-${id}`,
    startLine: 1,
    endLine: 10,
    content: `test content ${id}`,
    semantic_text: `test semantic ${id}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  beforeEach(async () => {
    // Clean up
    if (fs.existsSync(testQueueDir)) {
      fs.rmSync(testQueueDir, { recursive: true });
    }
    fs.mkdirSync(testQueueDir, { recursive: true });

    queue = new SqliteQueue({
      dbPath: queueDbPath,
      repoName: 'test-repo',
      branch: 'main',
    });
    await queue.initialize();
  });

  afterEach(() => {
    queue.close();
    if (fs.existsSync(testQueueDir)) {
      fs.rmSync(testQueueDir, { recursive: true });
    }
  });

  describe('WHEN tracking enqueue completion', () => {
    it('SHOULD start with enqueue not completed', async () => {
      expect(queue.isEnqueueCompleted()).toBe(false);
    });

    it('SHOULD mark enqueue as completed', async () => {
      expect(queue.isEnqueueCompleted()).toBe(false);

      await queue.markEnqueueCompleted();
      expect(queue.isEnqueueCompleted()).toBe(true);
    });

    it('SHOULD persist enqueue completion flag across queue instances', async () => {
      await queue.markEnqueueCompleted();
      expect(queue.isEnqueueCompleted()).toBe(true);
      queue.close();

      // Create new queue instance with same DB
      const queue2 = new SqliteQueue({
        dbPath: queueDbPath,
        repoName: 'test-repo',
        branch: 'main',
      });
      await queue2.initialize();

      expect(queue2.isEnqueueCompleted()).toBe(true);
      queue2.close();
    });

    it('SHOULD clear enqueue completion flag when queue is cleared', async () => {
      await queue.markEnqueueCompleted();
      expect(queue.isEnqueueCompleted()).toBe(true);

      await queue.clear();
      expect(queue.isEnqueueCompleted()).toBe(false);
    });

    it('SHOULD detect interrupted enqueue (items in queue but not completed)', async () => {
      // Simulate interrupted enqueue
      const chunks = Array(50)
        .fill(null)
        .map((_, i) => createMockChunk(i));
      await queue.enqueue(chunks);

      // Enqueue completion flag NOT set (simulating interruption)
      expect(queue.isEnqueueCompleted()).toBe(false);

      // Verify items are in queue
      const dequeued = await queue.dequeue(100);
      expect(dequeued.length).toBe(50);
    });
  });
});
