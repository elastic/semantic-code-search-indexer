import { SqliteQueue } from '../../src/utils/sqlite_queue';
import { CodeChunk } from '../../src/utils/elasticsearch';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('SqliteQueue Concurrency', () => {
  let queue: SqliteQueue;
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-concurrency-test-'));
    dbPath = path.join(tempDir, 'test-queue.db');
    queue = new SqliteQueue({
      dbPath,
      repoName: 'test-repo',
      branch: 'main',
    });
    await queue.initialize();
  });

  afterEach(() => {
    queue.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('WHEN multiple workers dequeue concurrently', () => {
    it('SHOULD NOT return duplicate documents', async () => {
      // Arrange: Create 100 test documents
      const documents: CodeChunk[] = [];
      for (let i = 0; i < 100; i++) {
        documents.push({
          type: 'code',
          language: 'typescript',
          filePath: `file${i}.ts`,
          directoryPath: '/test',
          directoryName: 'test',
          directoryDepth: 1,
          git_file_hash: `hash${i}`,
          git_branch: 'main',
          chunk_hash: `chunk${i}`,
          startLine: 1,
          endLine: 10,
          content: `content ${i}`,
          semantic_text: `semantic ${i}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      await queue.enqueue(documents);

      // Act: Simulate 4 concurrent workers dequeuing
      const dequeuePromises = [queue.dequeue(30), queue.dequeue(30), queue.dequeue(30), queue.dequeue(30)];

      const results = await Promise.all(dequeuePromises);

      // Assert: Collect all dequeued chunk_hashes
      const allChunkHashes = new Set<string>();
      let totalDequeued = 0;

      for (const batch of results) {
        totalDequeued += batch.length;
        for (const item of batch) {
          const chunkHash = item.document.chunk_hash;

          // Each chunk_hash should be unique (no duplicates)
          expect(allChunkHashes.has(chunkHash)).toBe(false);
          allChunkHashes.add(chunkHash);
        }
      }

      // Should have dequeued all 100 documents exactly once
      expect(totalDequeued).toBe(100);
      expect(allChunkHashes.size).toBe(100);
    });

    it('SHOULD handle concurrent dequeue with different batch sizes', async () => {
      // Arrange: Create 50 test documents
      const documents: CodeChunk[] = [];
      for (let i = 0; i < 50; i++) {
        documents.push({
          type: 'code',
          language: 'typescript',
          filePath: `file${i}.ts`,
          directoryPath: '/test',
          directoryName: 'test',
          directoryDepth: 1,
          git_file_hash: `hash${i}`,
          git_branch: 'main',
          chunk_hash: `chunk${i}`,
          startLine: 1,
          endLine: 10,
          content: `content ${i}`,
          semantic_text: `semantic ${i}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      await queue.enqueue(documents);

      // Act: Simulate workers with different batch sizes
      const dequeuePromises = [queue.dequeue(10), queue.dequeue(15), queue.dequeue(20), queue.dequeue(25)];

      const results = await Promise.all(dequeuePromises);

      // Assert: No duplicates
      const allChunkHashes = new Set<string>();
      let totalDequeued = 0;

      for (const batch of results) {
        totalDequeued += batch.length;
        for (const item of batch) {
          const chunkHash = item.document.chunk_hash;
          expect(allChunkHashes.has(chunkHash)).toBe(false);
          allChunkHashes.add(chunkHash);
        }
      }

      expect(totalDequeued).toBe(50);
      expect(allChunkHashes.size).toBe(50);
    });

    it('SHOULD correctly handle sequential dequeues after concurrent ones', async () => {
      // Arrange: Create 60 documents
      const documents: CodeChunk[] = [];
      for (let i = 0; i < 60; i++) {
        documents.push({
          type: 'code',
          language: 'typescript',
          filePath: `file${i}.ts`,
          directoryPath: '/test',
          directoryName: 'test',
          directoryDepth: 1,
          git_file_hash: `hash${i}`,
          git_branch: 'main',
          chunk_hash: `chunk${i}`,
          startLine: 1,
          endLine: 10,
          content: `content ${i}`,
          semantic_text: `semantic ${i}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      await queue.enqueue(documents);

      // Act: First concurrent dequeue
      const firstBatch = await Promise.all([queue.dequeue(10), queue.dequeue(10), queue.dequeue(10)]);

      // Then sequential dequeues
      const secondBatch = await queue.dequeue(15);
      const thirdBatch = await queue.dequeue(15);

      // Assert: Collect all chunk hashes
      const allChunkHashes = new Set<string>();

      for (const batch of firstBatch) {
        for (const item of batch) {
          allChunkHashes.add(item.document.chunk_hash);
        }
      }

      for (const item of secondBatch) {
        expect(allChunkHashes.has(item.document.chunk_hash)).toBe(false);
        allChunkHashes.add(item.document.chunk_hash);
      }

      for (const item of thirdBatch) {
        expect(allChunkHashes.has(item.document.chunk_hash)).toBe(false);
        allChunkHashes.add(item.document.chunk_hash);
      }

      expect(allChunkHashes.size).toBe(60);
    });
  });

  describe('WHEN dequeue is called with more items than available', () => {
    it('SHOULD return only available items without duplicates', async () => {
      // Arrange: Create only 10 documents
      const documents: CodeChunk[] = [];
      for (let i = 0; i < 10; i++) {
        documents.push({
          type: 'code',
          language: 'typescript',
          filePath: `file${i}.ts`,
          directoryPath: '/test',
          directoryName: 'test',
          directoryDepth: 1,
          git_file_hash: `hash${i}`,
          git_branch: 'main',
          chunk_hash: `chunk${i}`,
          startLine: 1,
          endLine: 10,
          content: `content ${i}`,
          semantic_text: `semantic ${i}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      await queue.enqueue(documents);

      // Act: Try to dequeue more than available concurrently
      const results = await Promise.all([queue.dequeue(20), queue.dequeue(20), queue.dequeue(20)]);

      // Assert: Should get 10 total items with no duplicates
      const allChunkHashes = new Set<string>();
      let totalDequeued = 0;

      for (const batch of results) {
        totalDequeued += batch.length;
        for (const item of batch) {
          const chunkHash = item.document.chunk_hash;
          expect(allChunkHashes.has(chunkHash)).toBe(false);
          allChunkHashes.add(chunkHash);
        }
      }

      expect(totalDequeued).toBe(10);
      expect(allChunkHashes.size).toBe(10);
    });
  });
});
