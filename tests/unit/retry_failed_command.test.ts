import { retryFailedCommand } from '../../src/commands/retry_failed_command';
import { SqliteQueue } from '../../src/utils/sqlite_queue';
import { CodeChunk } from '../../src/utils/elasticsearch';
import { appConfig } from '../../src/config';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

// Mock the config to use a temporary directory
vi.mock('../../src/config', () => ({
  appConfig: {
    queueBaseDir: './.test-queues',
  },
  otelConfig: {
    enabled: false,
    serviceName: 'test-service',
    endpoint: 'http://localhost:4318',
    headers: '',
    metricsEnabled: false,
    metricsEndpoint: 'http://localhost:4318',
    metricExportIntervalMs: 60000,
  },
}));

// Mock the logger to prevent console output during tests
vi.mock('../../src/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const MOCK_CHUNK_1: CodeChunk = {
  type: 'code',
  language: 'typescript',
  filePath: 'test1.ts',
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

const MOCK_CHUNK_2: CodeChunk = {
  type: 'code',
  language: 'typescript',
  filePath: 'test2.ts',
  directoryPath: '',
  directoryName: '',
  directoryDepth: 0,
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

const MOCK_CHUNK_3: CodeChunk = {
  type: 'code',
  language: 'typescript',
  filePath: 'test3.ts',
  directoryPath: '',
  directoryName: '',
  directoryDepth: 0,
  git_file_hash: 'hash3',
  git_branch: 'main',
  chunk_hash: 'chunk_hash_3',
  startLine: 1,
  endLine: 1,
  content: 'const c = 3;',
  semantic_text: 'const c = 3;',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('retryFailedCommand', () => {
  const repoName = 'test-repo';
  const queueDir = path.join(appConfig.queueBaseDir, repoName);
  const dbPath = path.join(queueDir, 'queue.db');
  let queue: SqliteQueue;

  beforeEach(async () => {
    // Use the actual file system
    fs.mkdirSync(queueDir, { recursive: true });

    // Seed the database
    queue = new SqliteQueue({ dbPath });
    await queue.initialize();
    await queue.enqueue([MOCK_CHUNK_1, MOCK_CHUNK_2, MOCK_CHUNK_3]);

    // Manually set some documents to 'failed'
    const db = new Database(dbPath);
    db.exec(`
      UPDATE queue
      SET status = 'failed', retry_count = 3
      WHERE id IN (1, 3)
    `);
    db.close();
  });

  afterEach(() => {
    queue.close();
    fs.rmSync(appConfig.queueBaseDir, { recursive: true, force: true });
  });

  it('should reset all failed documents to pending and clear their retry count', async () => {
    // --- Execute the command ---
    await retryFailedCommand.parseAsync(['', '', '--repo-name', repoName]);

    // --- Assert the outcome ---
    const db = new Database(dbPath);

    // Check the previously failed documents
    const doc1 = db.prepare('SELECT * FROM queue WHERE id = 1').get() as
      | { status: string; retry_count: number }
      | undefined;
    expect(doc1?.status).toBe('pending');
    expect(doc1?.retry_count).toBe(0);

    const doc3 = db.prepare('SELECT * FROM queue WHERE id = 3').get() as
      | { status: string; retry_count: number }
      | undefined;
    expect(doc3?.status).toBe('pending');
    expect(doc3?.retry_count).toBe(0);

    // Check the document that was not failed
    const doc2 = db.prepare('SELECT * FROM queue WHERE id = 2').get() as
      | { status: string; retry_count: number }
      | undefined;
    expect(doc2?.status).toBe('pending');
    expect(doc2?.retry_count).toBe(0); // Should be untouched

    db.close();
  });
});
