import { SqliteQueue } from '../src/utils/sqlite_queue';
import { CodeChunk } from '../src/utils/elasticsearch';
import path from 'path';
import fs from 'fs';

const MOCK_CHUNK: CodeChunk = {
  type: 'code',
  language: 'typescript',
  filePath: 'test.ts',
  directoryPath: '',
  directoryName: '',
  directoryDepth: 0,
  git_file_hash: 'hash',
  git_branch: 'main',
  chunk_hash: 'chunk_hash',
  startLine: 1,
  endLine: 1,
  content: 'const a = 1;',
  semantic_text: 'const a = 1;',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('SqliteQueue Scalability', () => {
  const queueDir = '.scalability-test-queue';
  const dbPath = path.join(queueDir, 'queue.db');
  let queue: SqliteQueue;

  beforeAll(async () => {
    if (fs.existsSync(queueDir)) {
      fs.rmSync(queueDir, { recursive: true, force: true });
    }
    fs.mkdirSync(queueDir, { recursive: true });
    queue = new SqliteQueue({ dbPath });
    await queue.initialize();
  });

  afterAll(() => {
    if (fs.existsSync(queueDir)) {
      fs.rmSync(queueDir, { recursive: true, force: true });
    }
  });

  it('should handle a large volume of documents without errors', async () => {
    const totalDocuments = 100000;
    const batchSize = 1000;
    let enqueuedCount = 0;
    let dequeuedCount = 0;

    console.log(`
--- Starting Scalability Test: ${totalDocuments} documents ---`);

    // --- Enqueue Phase ---
    const enqueueStartTime = Date.now();
    for (let i = 0; i < totalDocuments; i += batchSize) {
      // Create unique chunks with different chunk_hash to avoid deduplication
      const batch = Array(batchSize)
        .fill(null)
        .map((_, idx) => ({
          ...MOCK_CHUNK,
          chunk_hash: `test-chunk-${i + idx}`,
        }));
      await queue.enqueue(batch);
      enqueuedCount += batch.length;
    }
    const enqueueEndTime = Date.now();
    console.log(`Enqueue Phase completed in ${(enqueueEndTime - enqueueStartTime) / 1000}s`);
    expect(enqueuedCount).toBe(totalDocuments);

    // --- Dequeue and Commit Phase ---
    const dequeueStartTime = Date.now();
    while (true) {
      const dequeuedDocs = await queue.dequeue(batchSize);
      if (dequeuedDocs.length === 0) {
        break;
      }
      dequeuedCount += dequeuedDocs.length;
      await queue.commit(dequeuedDocs);
    }
    const dequeueEndTime = Date.now();
    console.log(`Dequeue & Commit Phase completed in ${(dequeueEndTime - dequeueStartTime) / 1000}s`);
    expect(dequeuedCount).toBe(totalDocuments);

    // --- Final Verification ---
    const remainingDocs = await queue.dequeue(1);
    expect(remainingDocs.length).toBe(0);

    console.log('--- Scalability Test Passed ---');
  }, 300000); // Increase timeout to 5 minutes for this long-running test
});
