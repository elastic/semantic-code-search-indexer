import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

import { SqliteQueue } from '../../src/utils/sqlite_queue';
import { CodeChunk } from '../../src/utils/elasticsearch';

/**
 * Test interface exposing private members of SqliteQueue for unit testing.
 * This is a standalone interface (not extending SqliteQueue) to avoid TS errors
 * about private property visibility.
 */
interface SqliteQueueTestable {
  db: Database.Database;
}

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
    queue.close();
    if (fs.existsSync(queueDir)) {
      fs.rmSync(queueDir, { recursive: true, force: true });
    }
  });

  it('should have idx_status_created index for efficient dequeue', () => {
    const db = new Database(dbPath, { readonly: true });
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'queue'").all() as {
      name: string;
    }[];
    db.close();

    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_status_created');
  });

  it('should have WAL journal mode enabled', () => {
    const db = new Database(dbPath, { readonly: true });
    const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    db.close();

    expect(result.journal_mode).toBe('wal');
  });

  it('should have performance PRAGMAs configured correctly', () => {
    // Access the queue's internal DB connection to check session-specific PRAGMAs
    // (PRAGMAs like cache_size, synchronous, temp_store are connection-specific)
    const testableQueue = queue as unknown as SqliteQueueTestable;
    const db = testableQueue.db;

    // synchronous=NORMAL (1) is safe for WAL mode and faster than FULL (2)
    const synchronous = db.prepare('PRAGMA synchronous').get() as { synchronous: number };
    expect(synchronous.synchronous).toBe(1); // NORMAL

    // cache_size should be negative (KB) and at least 64MB
    const cacheSize = db.prepare('PRAGMA cache_size').get() as { cache_size: number };
    expect(cacheSize.cache_size).toBeLessThanOrEqual(-64000); // -64000 KB = 64MB

    // temp_store=MEMORY (2) keeps temp tables in RAM
    const tempStore = db.prepare('PRAGMA temp_store').get() as { temp_store: number };
    expect(tempStore.temp_store).toBe(2); // MEMORY

    // mmap_size should be at least 256MB for memory-mapped I/O
    const mmapSize = db.prepare('PRAGMA mmap_size').get() as { mmap_size: number };
    expect(mmapSize.mmap_size).toBeGreaterThanOrEqual(268435456); // 256MB
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
  }); // Increase timeout to 5 minutes for this long-running test

  it('should keep WAL file size reasonable after many commits', async () => {
    // Create a fresh queue for this test
    const checkpointQueueDir = '.checkpoint-test-queue';
    const checkpointDbPath = path.join(checkpointQueueDir, 'queue.db');
    const checkpointWalPath = checkpointDbPath + '-wal';

    if (fs.existsSync(checkpointQueueDir)) {
      fs.rmSync(checkpointQueueDir, { recursive: true, force: true });
    }
    fs.mkdirSync(checkpointQueueDir, { recursive: true });

    const checkpointQueue = new SqliteQueue({ dbPath: checkpointDbPath });
    await checkpointQueue.initialize();

    // Perform 150 commit cycles (should trigger at least 1 checkpoint at interval 100)
    for (let cycle = 0; cycle < 150; cycle++) {
      const docs = Array.from({ length: 10 }, (_, i) => ({
        ...MOCK_CHUNK,
        chunk_hash: `checkpoint-test-${cycle}-${i}`,
      }));
      await checkpointQueue.enqueue(docs);
      const dequeued = await checkpointQueue.dequeue(10);
      await checkpointQueue.commit(dequeued);
    }

    // Check WAL file size - it should be reasonable with periodic checkpointing
    if (fs.existsSync(checkpointWalPath)) {
      const walStats = fs.statSync(checkpointWalPath);
      const walSizeMB = walStats.size / (1024 * 1024);
      console.log(`WAL file size after 150 commit cycles: ${walSizeMB.toFixed(2)} MB`);

      // WAL should be under 10MB - prevents unbounded growth (1.4GB seen in production)
      expect(walStats.size).toBeLessThan(10 * 1024 * 1024);
    }

    checkpointQueue.close();
    fs.rmSync(checkpointQueueDir, { recursive: true, force: true });
  });
});
