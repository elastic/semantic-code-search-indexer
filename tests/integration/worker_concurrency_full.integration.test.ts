import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

import { getClient, createIndex, createLocationsIndex, CodeChunk } from '../../src/utils/elasticsearch';
import { SqliteQueue } from '../../src/utils/sqlite_queue';
import { IndexerWorker } from '../../src/utils/indexer_worker';

const INDEX_PREFIX = `test-worker-full-${Date.now()}`;

async function isElasticsearchAvailable(): Promise<boolean> {
  try {
    await getClient().ping();
    return true;
  } catch {
    return false;
  }
}

function makeChunk(params: { filePath: string; startLine: number; content: string }): CodeChunk {
  const now = new Date().toISOString();
  return {
    type: 'code',
    language: 'typescript',
    kind: 'function_declaration',
    containerPath: 'hello',
    filePath: params.filePath,
    directoryPath: '',
    directoryName: '',
    directoryDepth: 0,
    git_file_hash: 'hash',
    git_branch: 'main',
    chunk_hash: `chunk-${params.filePath}-${params.startLine}`,
    startLine: params.startLine,
    endLine: params.startLine,
    content: params.content,
    semantic_text: params.content,
    created_at: now,
    updated_at: now,
  };
}

describe('Integration Test - Worker drain + concurrency + stale recovery (deterministic)', () => {
  const createdIndices: string[] = [];
  const createdQueues: string[] = [];

  beforeAll(async () => {
    const esAvailable = await isElasticsearchAvailable();
    if (!esAvailable) {
      throw new Error(
        'Elasticsearch is not available. Run `npm run test:integration:setup` first to start Elasticsearch via Docker Compose.'
      );
    }
  }, 120000);

  afterAll(async () => {
    try {
      const client = getClient();
      for (const idx of createdIndices) {
        try {
          await client.indices.delete({ index: idx });
        } catch {
          // ignore
        }
        try {
          await client.indices.delete({ index: `${idx}_locations` });
        } catch {
          // ignore
        }
        try {
          await client.indices.delete({ index: `${idx}_settings` });
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    for (const q of createdQueues) {
      try {
        fs.rmSync(q, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  beforeEach(() => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';
    process.env.DISABLE_SEMANTIC_TEXT = 'true';
  });

  afterEach(() => {
    delete process.env.TEST_INDEXING_DELAY_MS;
    delete process.env.TEST_INDEXING_THROW_ON_FILEPATH;
  });

  it('should not exit early when queue is empty but tasks are still in-flight (drain correctness)', async () => {
    // Force slow indexing so the worker experiences: queue empty while tasks are still running.
    process.env.TEST_INDEXING_DELAY_MS = '200';

    const indexName = `${INDEX_PREFIX}-drain`;
    createdIndices.push(indexName);
    await createIndex(indexName);
    await createLocationsIndex(indexName);

    const queueDir = path.join(os.tmpdir(), `test-worker-drain-queue-${Date.now()}`);
    createdQueues.push(queueDir);
    const queueDbPath = path.join(queueDir, 'queue.db');
    const queue = new SqliteQueue({ dbPath: queueDbPath, repoName: 'drain', branch: 'main' });
    await queue.initialize();

    // Two items, batchSize=1, concurrency=2 -> worker will dequeue both quickly then see queue empty while indexing is running.
    const sharedContent = `function hello() {\n  console.log("world");\n}\n`;
    await queue.enqueue([makeChunk({ filePath: 'a.ts', startLine: 1, content: sharedContent })]);
    await queue.enqueue([makeChunk({ filePath: 'b.ts', startLine: 1, content: sharedContent })]);

    const worker = new IndexerWorker({
      queue,
      batchSize: 1,
      concurrency: 2,
      watch: false,
      elasticsearchIndex: indexName,
      repoInfo: { name: 'drain', branch: 'main' },
    });

    await worker.start();

    // If the worker exited early, rows could remain in queue (pending/processing).
    const db = new Database(queueDbPath, { readonly: true });
    const row = db.prepare('SELECT COUNT(*) as count FROM queue').get() as { count: number };
    db.close();
    expect(row.count).toBe(0);
  }, 180000);

  it('should requeue a batch if indexing throws, so no rows remain stuck in processing', async () => {
    process.env.TEST_INDEXING_THROW_ON_FILEPATH = 'boom.ts';

    const indexName = `${INDEX_PREFIX}-throw-requeue`;
    createdIndices.push(indexName);
    await createIndex(indexName);
    await createLocationsIndex(indexName);

    const queueDir = path.join(os.tmpdir(), `test-worker-throw-queue-${Date.now()}`);
    createdQueues.push(queueDir);
    const queueDbPath = path.join(queueDir, 'queue.db');
    const queue = new SqliteQueue({ dbPath: queueDbPath, repoName: 'throw', branch: 'main' });
    await queue.initialize();

    const content = `function hello() {\n  console.log("world");\n}\n`;
    await queue.enqueue([
      makeChunk({ filePath: 'boom.ts', startLine: 1, content }),
      makeChunk({ filePath: 'ok.ts', startLine: 1, content }),
    ]);

    const worker = new IndexerWorker({
      queue,
      batchSize: 2,
      concurrency: 1,
      watch: false,
      elasticsearchIndex: indexName,
      repoInfo: { name: 'throw', branch: 'main' },
    });

    await worker.start();

    // Regardless of the thrown attempt, worker should finish with no stuck processing rows.
    const db = new Database(queueDbPath, { readonly: true });
    const processing = db.prepare("SELECT COUNT(*) as count FROM queue WHERE status = 'processing'").get() as {
      count: number;
    };
    db.close();
    expect(processing.count).toBe(0);
  }, 180000);

  it('should not lose locations under real worker concurrency across many dequeue batches', async () => {
    // Slow down indexing so we get overlapping in-flight work.
    process.env.TEST_INDEXING_DELAY_MS = '150';

    const indexName = `${INDEX_PREFIX}-agg-concurrency`;
    createdIndices.push(indexName);
    await createIndex(indexName);
    await createLocationsIndex(indexName);

    const queueDir = path.join(os.tmpdir(), `test-worker-agg-concurrency-queue-${Date.now()}`);
    createdQueues.push(queueDir);
    const queueDbPath = path.join(queueDir, 'queue.db');
    const queue = new SqliteQueue({ dbPath: queueDbPath, repoName: 'agg', branch: 'main' });
    await queue.initialize();

    const content = `function hello() {\n  console.log("world");\n}\n`;
    const fileCount = 40;
    const chunks: CodeChunk[] = [];
    for (let i = 1; i <= fileCount; i++) {
      chunks.push(makeChunk({ filePath: `file${i}.ts`, startLine: i, content }));
    }
    // Enqueue all in one call to keep DB writes quick.
    await queue.enqueue(chunks);

    const worker = new IndexerWorker({
      queue,
      batchSize: 1,
      concurrency: 4,
      watch: false,
      elasticsearchIndex: indexName,
      repoInfo: { name: 'agg', branch: 'main' },
    });

    await worker.start();

    const client = getClient();
    await client.indices.refresh({ index: indexName });
    await client.indices.refresh({ index: `${indexName}_locations` });

    const response = await client.search<CodeChunk>({
      index: indexName,
      query: { match_all: {} },
      size: 200,
    });

    const relevantIds = response.hits.hits
      .filter((h) => h._source?.content.includes('console.log("world")'))
      .map((h) => h._id);
    expect(relevantIds.length).toBeGreaterThan(0);

    const expected = Array.from({ length: fileCount }, (_, i) => `file${i + 1}.ts`).sort();
    for (const chunkId of relevantIds) {
      const locations = await client.search({
        index: `${indexName}_locations`,
        query: { term: { chunk_id: chunkId } },
        size: 5000,
        _source: ['filePath'],
      });
      const paths = locations.hits.hits
        .map((h) => (h._source as { filePath?: unknown } | undefined)?.filePath)
        .filter((p): p is string => typeof p === 'string')
        .slice()
        .sort();
      expect(paths).toEqual(expected);
    }
  }, 300000);

  it('should requeue stale tasks at scale for many distinct dead worker_pids (batching safety)', async () => {
    const queueDir = path.join(os.tmpdir(), `test-worker-stale-queue-${Date.now()}`);
    createdQueues.push(queueDir);
    const queueDbPath = path.join(queueDir, 'queue.db');
    const queue = new SqliteQueue({ dbPath: queueDbPath, repoName: 'stale', branch: 'main' });
    await queue.initialize();

    // Enqueue enough rows to exceed typical SQLite variable limits if implementation attempted a single giant IN list.
    const total = 1100;
    const docs: CodeChunk[] = [];
    for (let i = 0; i < total; i++) {
      docs.push(
        makeChunk({
          filePath: `stale${i + 1}.ts`,
          startLine: 1,
          content: `export const x${i} = ${i};`,
        })
      );
    }
    await queue.enqueue(docs);

    // Force them into "processing" with distinct dead PIDs.
    const db = new Database(queueDbPath);
    db.exec(`
      UPDATE queue
      SET status = 'processing',
          processing_started_at = CURRENT_TIMESTAMP,
          worker_pid = id + 1000000
    `);

    // Sanity: we have many distinct pids.
    const pidCount = db
      .prepare("SELECT COUNT(DISTINCT worker_pid) as count FROM queue WHERE status = 'processing'")
      .get() as {
      count: number;
    };
    expect(pidCount.count).toBeGreaterThan(1000);
    db.close();

    await queue.requeueStaleTasks();

    const db2 = new Database(queueDbPath, { readonly: true });
    const counts = db2.prepare('SELECT status, COUNT(*) as count FROM queue GROUP BY status').all() as Array<{
      status: string;
      count: number;
    }>;
    db2.close();

    const byStatus = new Map(counts.map((c) => [c.status, c.count]));
    expect(byStatus.get('processing') ?? 0).toBe(0);
    expect(byStatus.get('pending') ?? 0).toBe(total);
  }, 180000);
});
