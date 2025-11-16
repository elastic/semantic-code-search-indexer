import { SqliteQueue } from '../src/utils/sqlite_queue';
import { CodeChunk } from '../src/utils/elasticsearch';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

describe('SqliteQueue - PID Tracking', () => {
  const testDbDir = path.join(__dirname, '.test-queues-pid');
  const testDbPath = path.join(testDbDir, 'pid-test-queue.db');
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

  const createTestDoc = (filePath: string): CodeChunk => ({
    type: 'code',
    language: 'typescript',
    filePath,
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
  });

  describe('WHEN storing worker_pid', () => {
    it('SHOULD store current process PID when dequeuing', async () => {
      const testDoc = createTestDoc('/test/file1.ts');
      await queue.enqueue([testDoc]);

      const batch = await queue.dequeue(1);
      expect(batch).toHaveLength(1);

      const db = new Database(testDbPath, { readonly: true });
      const row = db.prepare('SELECT worker_pid FROM queue WHERE id = 1').get() as { worker_pid: number };
      db.close();

      expect(row.worker_pid).toBe(process.pid);
    });

    it('SHOULD clear worker_pid when requeuing', async () => {
      const testDoc = createTestDoc('/test/file2.ts');
      await queue.enqueue([testDoc]);

      const batch = await queue.dequeue(1);
      expect(batch).toHaveLength(1);

      const db = new Database(testDbPath);
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      db.prepare('UPDATE queue SET processing_started_at = ? WHERE id = 1').run(sixMinutesAgo);
      db.close();

      await queue.requeueStaleTasks();

      const dbCheck = new Database(testDbPath, { readonly: true });
      const row = dbCheck.prepare('SELECT status, worker_pid FROM queue WHERE id = 1').get() as {
        status: string;
        worker_pid: number | null;
      };
      dbCheck.close();

      expect(row.status).toBe('pending');
      expect(row.worker_pid).toBeNull();
    });
  });

  describe('WHEN requeueing stale tasks with PID tracking', () => {
    it('SHOULD immediately requeue items from dead processes', async () => {
      const testDoc = createTestDoc('/test/file3.ts');
      await queue.enqueue([testDoc]);

      await queue.dequeue(1);

      const fakePid = 999999;
      const db = new Database(testDbPath);
      db.prepare('UPDATE queue SET worker_pid = ? WHERE id = 1').run(fakePid);
      db.close();

      await queue.requeueStaleTasks();

      const dbCheck = new Database(testDbPath, { readonly: true });
      const row = dbCheck.prepare('SELECT status FROM queue WHERE id = 1').get() as { status: string };
      dbCheck.close();

      expect(row.status).toBe('pending');
    });

    it('SHOULD NOT requeue items from running processes if recent', async () => {
      const testDoc = createTestDoc('/test/file4.ts');
      await queue.enqueue([testDoc]);

      await queue.dequeue(1);
      await queue.requeueStaleTasks();

      const db = new Database(testDbPath, { readonly: true });
      const row = db.prepare('SELECT status FROM queue WHERE id = 1').get() as { status: string };
      db.close();

      expect(row.status).toBe('processing');
    });

    it('SHOULD requeue items from running processes if older than 5 minutes (hung process)', async () => {
      const testDoc = createTestDoc('/test/file5.ts');
      await queue.enqueue([testDoc]);

      await queue.dequeue(1);

      const db = new Database(testDbPath);
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      db.prepare('UPDATE queue SET processing_started_at = ? WHERE id = 1').run(sixMinutesAgo);
      db.close();

      await queue.requeueStaleTasks();

      const dbCheck = new Database(testDbPath, { readonly: true });
      const row = dbCheck.prepare('SELECT status FROM queue WHERE id = 1').get() as { status: string };
      dbCheck.close();

      expect(row.status).toBe('pending');
    });

    it('SHOULD handle legacy items with NULL worker_pid using timestamp check', async () => {
      const testDoc = createTestDoc('/test/file6.ts');
      await queue.enqueue([testDoc]);

      const db = new Database(testDbPath);
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      db.prepare('UPDATE queue SET status = ?, processing_started_at = ?, worker_pid = NULL WHERE id = 1').run(
        'processing',
        sixMinutesAgo
      );
      db.close();

      await queue.requeueStaleTasks();

      const dbCheck = new Database(testDbPath, { readonly: true });
      const row = dbCheck.prepare('SELECT status FROM queue WHERE id = 1').get() as { status: string };
      dbCheck.close();

      expect(row.status).toBe('pending');
    });

    it('SHOULD NOT requeue legacy items with NULL worker_pid if recent', async () => {
      const testDoc = createTestDoc('/test/file7.ts');
      await queue.enqueue([testDoc]);

      const db = new Database(testDbPath);
      db.prepare(
        'UPDATE queue SET status = ?, processing_started_at = CURRENT_TIMESTAMP, worker_pid = NULL WHERE id = 1'
      ).run('processing');
      db.close();

      await queue.requeueStaleTasks();

      const dbCheck = new Database(testDbPath, { readonly: true });
      const row = dbCheck.prepare('SELECT status FROM queue WHERE id = 1').get() as { status: string };
      dbCheck.close();

      expect(row.status).toBe('processing');
    });

    it('SHOULD requeue items with invalid timestamps', async () => {
      const testDoc = createTestDoc('/test/file8.ts');
      await queue.enqueue([testDoc]);

      const db = new Database(testDbPath);
      db.prepare('UPDATE queue SET status = ?, processing_started_at = ?, worker_pid = NULL WHERE id = 1').run(
        'processing',
        'invalid-timestamp'
      );
      db.close();

      await queue.requeueStaleTasks();

      const dbCheck = new Database(testDbPath, { readonly: true });
      const row = dbCheck.prepare('SELECT status FROM queue WHERE id = 1').get() as { status: string };
      dbCheck.close();

      expect(row.status).toBe('pending');
    });

    it('SHOULD handle multiple items from different PIDs', async () => {
      const docs = [
        createTestDoc('/test/file9.ts'),
        createTestDoc('/test/file10.ts'),
        createTestDoc('/test/file11.ts'),
      ];
      await queue.enqueue(docs);

      await queue.dequeue(3);

      const db = new Database(testDbPath);
      const currentPid = process.pid;
      const deadPid = 999999;
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();

      db.prepare('UPDATE queue SET worker_pid = ? WHERE id = 1').run(deadPid);
      db.prepare('UPDATE queue SET worker_pid = ? WHERE id = 2').run(currentPid);
      db.prepare('UPDATE queue SET worker_pid = ?, processing_started_at = ? WHERE id = 3').run(
        currentPid,
        sixMinutesAgo
      );
      db.close();

      await queue.requeueStaleTasks();

      const dbCheck = new Database(testDbPath, { readonly: true });
      const rows = dbCheck.prepare('SELECT id, status FROM queue ORDER BY id').all() as {
        id: number;
        status: string;
      }[];
      dbCheck.close();

      expect(rows[0].status).toBe('pending'); // Item 1: dead process → requeued
      expect(rows[1].status).toBe('processing'); // Item 2: live process, recent → not requeued
      expect(rows[2].status).toBe('pending'); // Item 3: live process, hung → requeued
    });

    it('SHOULD handle mixed SQLite and ISO timestamp formats', async () => {
      const testDoc = createTestDoc('/test/file12.ts');
      await queue.enqueue([testDoc]);

      await queue.dequeue(1);

      const db = new Database(testDbPath);
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      const sqliteFormat = sixMinutesAgo
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '');

      db.prepare('UPDATE queue SET worker_pid = ?, processing_started_at = ? WHERE id = 1').run(999999, sqliteFormat);
      db.close();

      await queue.requeueStaleTasks();

      const dbCheck = new Database(testDbPath, { readonly: true });
      const row = dbCheck.prepare('SELECT status FROM queue WHERE id = 1').get() as { status: string };
      dbCheck.close();

      expect(row.status).toBe('pending');
    });
  });

  describe('WHEN migrating existing database', () => {
    it('SHOULD add worker_pid column to existing database', async () => {
      const migrationDbPath = path.join(testDbDir, 'migration-test.db');

      const oldDb = new Database(migrationDbPath);
      oldDb.exec('PRAGMA journal_mode = WAL;');
      oldDb.exec(`
        CREATE TABLE queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          batch_id TEXT NOT NULL,
          document TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          retry_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          processing_started_at TIMESTAMP
        );
      `);
      oldDb.close();

      const migratedQueue = new SqliteQueue({
        dbPath: migrationDbPath,
        repoName: 'test-repo',
        branch: 'main',
      });
      await migratedQueue.initialize();

      const db = new Database(migrationDbPath, { readonly: true });
      const tableInfo = db.prepare('PRAGMA table_info(queue)').all() as { name: string }[];
      db.close();

      const hasWorkerPid = tableInfo.some((col) => col.name === 'worker_pid');
      expect(hasWorkerPid).toBe(true);

      migratedQueue.close();
    });
  });
});
