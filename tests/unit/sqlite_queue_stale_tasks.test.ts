import { SqliteQueue } from '../../src/utils/sqlite_queue';
import { CodeChunk } from '../../src/utils/elasticsearch';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('SqliteQueue - Stale Task Recovery', () => {
  const testDbDir = path.join(__dirname, '.test-queues');
  const testDbPath = path.join(testDbDir, 'stale-test-queue.db');
  let queue: SqliteQueue;

  beforeEach(async () => {
    // Clean up any existing test database
    if (fs.existsSync(testDbDir)) {
      fs.rmSync(testDbDir, { recursive: true });
    }
    fs.mkdirSync(testDbDir, { recursive: true });

    queue = new SqliteQueue({
      dbPath: testDbPath,
      repoName: 'test-repo',
      branch: 'main',
    });
    await queue.initialize();
  });

  afterEach(() => {
    queue.close();
    if (fs.existsSync(testDbDir)) {
      fs.rmSync(testDbDir, { recursive: true });
    }
  });

  describe('WHEN requeueing stale tasks', () => {
    it('SHOULD requeue tasks with SQLite CURRENT_TIMESTAMP format (older than 5 minutes)', async () => {
      // Enqueue a test document
      const testDoc: CodeChunk = {
        type: 'code',
        language: 'typescript',
        filePath: '/test/file.ts',
        directoryPath: '/test',
        directoryName: 'test',
        directoryDepth: 1,
        git_file_hash: 'abc123',
        git_branch: 'main',
        chunk_hash: 'def456',
        startLine: 1,
        endLine: 10,
        content: 'test content',
        semantic_text: 'test content',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await queue.enqueue([testDoc]);

      // Dequeue it (this sets status to 'processing' with CURRENT_TIMESTAMP)
      const batch = await queue.dequeue(1);
      expect(batch).toHaveLength(1);

      // Manually set the processing_started_at to 6 minutes ago using SQLite format
      const db = new Database(testDbPath);
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      const sqliteTimestamp = sixMinutesAgo
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '');

      db.prepare('UPDATE queue SET processing_started_at = ? WHERE id = ?').run(sqliteTimestamp, 1);
      db.close();

      // Call requeueStaleTasks - should find and requeue the item
      await queue.requeueStaleTasks();

      // Verify the item was requeued (status should be 'pending')
      const requeuedBatch = await queue.dequeue(1);
      expect(requeuedBatch).toHaveLength(1);
      expect(requeuedBatch[0].document.filePath).toBe('/test/file.ts');
    });

    it('SHOULD requeue tasks with ISO 8601 format (older than 5 minutes)', async () => {
      const testDoc: CodeChunk = {
        type: 'code',
        language: 'typescript',
        filePath: '/test/file2.ts',
        directoryPath: '/test',
        directoryName: 'test',
        directoryDepth: 1,
        git_file_hash: 'abc456',
        git_branch: 'main',
        chunk_hash: 'def789',
        startLine: 1,
        endLine: 10,
        content: 'test content 2',
        semantic_text: 'test content 2',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await queue.enqueue([testDoc]);

      const batch = await queue.dequeue(1);
      expect(batch).toHaveLength(1);

      // Manually set the processing_started_at to 6 minutes ago using ISO 8601 format
      const db = new Database(testDbPath);
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      const isoTimestamp = sixMinutesAgo.toISOString();

      db.prepare('UPDATE queue SET processing_started_at = ? WHERE id = ?').run(isoTimestamp, 1);
      db.close();

      await queue.requeueStaleTasks();

      const requeuedBatch = await queue.dequeue(1);
      expect(requeuedBatch).toHaveLength(1);
      expect(requeuedBatch[0].document.filePath).toBe('/test/file2.ts');
    });

    it('SHOULD not requeue tasks that are still fresh (less than 5 minutes)', async () => {
      const testDoc: CodeChunk = {
        type: 'code',
        language: 'typescript',
        filePath: '/test/file3.ts',
        directoryPath: '/test',
        directoryName: 'test',
        directoryDepth: 1,
        git_file_hash: 'abc789',
        git_branch: 'main',
        chunk_hash: 'def012',
        startLine: 1,
        endLine: 10,
        content: 'test content 3',
        semantic_text: 'test content 3',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await queue.enqueue([testDoc]);

      const batch = await queue.dequeue(1);
      expect(batch).toHaveLength(1);

      // Call requeueStaleTasks immediately (item is fresh)
      await queue.requeueStaleTasks();

      // Verify the item was NOT requeued (still in 'processing')
      const pendingBatch = await queue.dequeue(1);
      expect(pendingBatch).toHaveLength(0);
    });

    it('SHOULD handle mixed stale and fresh tasks', async () => {
      const staleDoc: CodeChunk = {
        type: 'code',
        language: 'typescript',
        filePath: '/test/stale.ts',
        directoryPath: '/test',
        directoryName: 'test',
        directoryDepth: 1,
        git_file_hash: 'stale123',
        git_branch: 'main',
        chunk_hash: 'stale456',
        startLine: 1,
        endLine: 10,
        content: 'stale content',
        semantic_text: 'stale content',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const freshDoc: CodeChunk = {
        type: 'code',
        language: 'typescript',
        filePath: '/test/fresh.ts',
        directoryPath: '/test',
        directoryName: 'test',
        directoryDepth: 1,
        git_file_hash: 'fresh123',
        git_branch: 'main',
        chunk_hash: 'fresh456',
        startLine: 1,
        endLine: 10,
        content: 'fresh content',
        semantic_text: 'fresh content',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await queue.enqueue([staleDoc, freshDoc]);

      const batch = await queue.dequeue(2);
      expect(batch).toHaveLength(2);

      // Make first task stale (6 minutes ago)
      const db = new Database(testDbPath);
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      const sqliteTimestamp = sixMinutesAgo
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '');

      db.prepare('UPDATE queue SET processing_started_at = ? WHERE id = 1').run(sqliteTimestamp);
      db.close();

      await queue.requeueStaleTasks();

      // Only stale task should be requeued
      const requeuedBatch = await queue.dequeue(1);
      expect(requeuedBatch).toHaveLength(1);
      expect(requeuedBatch[0].document.filePath).toBe('/test/stale.ts');
    });
  });
});
