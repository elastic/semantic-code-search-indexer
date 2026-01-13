import { getClient, CodeChunk, getLastIndexedCommit } from '../../src/utils/elasticsearch';
import { setup } from '../../src/commands/setup_command';
import { indexRepos } from '../../src/commands/index_command';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

const INDEX_PREFIX = `test-aggregation-behaviors-${Date.now()}`;

async function isElasticsearchAvailable(): Promise<boolean> {
  try {
    await getClient().ping();
    return true;
  } catch {
    return false;
  }
}

function initGitRepo(repoPath: string): void {
  // Make the initial branch deterministic across environments (some git versions default to `master`).
  // `indexRepos` stores commit hashes under the current branch name in `<index>_settings`, and some
  // tests read that state back using `main`.
  try {
    execSync('git init -b main', { cwd: repoPath, stdio: 'ignore' });
  } catch {
    execSync('git init', { cwd: repoPath, stdio: 'ignore' });
    const branch = execSync('git symbolic-ref --short HEAD', { cwd: repoPath }).toString().trim();
    if (branch !== 'main') {
      execSync('git checkout -b main', { cwd: repoPath, stdio: 'ignore' });
    }
  }
  execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: repoPath, stdio: 'ignore' });
}

function gitCommitAll(repoPath: string, message: string): string {
  execSync('git add .', { cwd: repoPath, stdio: 'ignore' });
  execSync(`git commit -m "${message}"`, { cwd: repoPath, stdio: 'ignore' });
  return execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
}

async function getAnyChunkIdForNeedle(params: {
  client: ReturnType<typeof getClient>;
  indexName: string;
  needle: string;
}): Promise<string> {
  const response = await params.client.search<CodeChunk>({
    index: params.indexName,
    query: { match_all: {} },
    size: 500,
  });
  const hit = response.hits.hits.find((h) => h._source?.content.includes(params.needle));
  if (!hit?._id) {
    throw new Error(`Could not find a chunk document containing needle=${params.needle}`);
  }
  return hit._id;
}

async function getFilePathsForChunkId(params: {
  client: ReturnType<typeof getClient>;
  indexName: string;
  chunkId: string;
}): Promise<string[]> {
  const response = await params.client.search({
    index: `${params.indexName}_locations`,
    query: { term: { chunk_id: params.chunkId } },
    size: 5000,
    _source: ['filePath'],
  });
  return response.hits.hits
    .map((h) => (h._source as { filePath?: unknown } | undefined)?.filePath)
    .filter((p): p is string => typeof p === 'string')
    .slice()
    .sort();
}

describe('Integration Test - Locations-first behaviors (incremental, deletion, filtering, caps removed)', () => {
  const createdIndices: string[] = [];
  const createdRepos: string[] = [];

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

    for (const repoPath of createdRepos) {
      try {
        fs.rmSync(repoPath, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('should update line ranges for a modified file (incremental) without affecting other file locations', async () => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';
    process.env.DISABLE_SEMANTIC_TEXT = 'true';

    const indexName = `${INDEX_PREFIX}-incremental-modify`;
    createdIndices.push(indexName);

    const repoPath = path.join(os.tmpdir(), `test-agg-incremental-modify-${Date.now()}`);
    createdRepos.push(repoPath);
    fs.mkdirSync(repoPath, { recursive: true });
    initGitRepo(repoPath);

    const baseContent = `function hello() {\n  console.log("world");\n}\n`;
    fs.writeFileSync(path.join(repoPath, 'file1.ts'), baseContent);
    fs.writeFileSync(path.join(repoPath, 'file2.ts'), baseContent);
    gitCommitAll(repoPath, 'Initial');

    const repoUrl = `file://${repoPath}`;

    await setup(repoUrl, {});
    await indexRepos([`${repoUrl}:${indexName}`], { watch: false, concurrency: '2' });

    const client = getClient();
    await client.indices.refresh({ index: indexName });
    await client.indices.refresh({ index: `${indexName}_locations` });

    const chunkId = await getAnyChunkIdForNeedle({ client, indexName, needle: 'console.log("world")' });
    expect(await getFilePathsForChunkId({ client, indexName, chunkId })).toEqual(['file1.ts', 'file2.ts']);

    const file1Before = await client.search({
      index: `${indexName}_locations`,
      query: { bool: { must: [{ term: { chunk_id: chunkId } }, { term: { filePath: 'file1.ts' } }] } },
      size: 1,
      _source: ['startLine', 'endLine'],
    });
    const file2Before = await client.search({
      index: `${indexName}_locations`,
      query: { bool: { must: [{ term: { chunk_id: chunkId } }, { term: { filePath: 'file2.ts' } }] } },
      size: 1,
      _source: ['startLine', 'endLine'],
    });
    const before1 = file1Before.hits.hits[0]?._source as { startLine?: number; endLine?: number } | undefined;
    const before2 = file2Before.hits.hits[0]?._source as { startLine?: number; endLine?: number } | undefined;
    expect(typeof before1?.startLine).toBe('number');
    expect(typeof before2?.startLine).toBe('number');

    // Modify only file1: add lines above to shift startLine/endLine.
    fs.writeFileSync(path.join(repoPath, 'file1.ts'), `// header\n// header2\n\n${baseContent}`);
    gitCommitAll(repoPath, 'Modify file1');

    await indexRepos([`${repoUrl}:${indexName}`], { watch: false, pull: true, concurrency: '2' });
    await client.indices.refresh({ index: indexName });
    await client.indices.refresh({ index: `${indexName}_locations` });

    expect(await getFilePathsForChunkId({ client, indexName, chunkId })).toEqual(['file1.ts', 'file2.ts']);

    const file1After = await client.search({
      index: `${indexName}_locations`,
      query: { bool: { must: [{ term: { chunk_id: chunkId } }, { term: { filePath: 'file1.ts' } }] } },
      size: 1,
      _source: ['startLine', 'endLine'],
    });
    const file2After = await client.search({
      index: `${indexName}_locations`,
      query: { bool: { must: [{ term: { chunk_id: chunkId } }, { term: { filePath: 'file2.ts' } }] } },
      size: 1,
      _source: ['startLine', 'endLine'],
    });
    const after1 = file1After.hits.hits[0]?._source as { startLine?: number; endLine?: number } | undefined;
    const after2 = file2After.hits.hits[0]?._source as { startLine?: number; endLine?: number } | undefined;
    expect(after2?.startLine).toBe(before2?.startLine);
    expect(after2?.endLine).toBe(before2?.endLine);
    expect(after1?.startLine).not.toBe(before1?.startLine);
  }, 300000);

  it('should handle incremental rename (R status) for aggregated docs', async () => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';
    process.env.DISABLE_SEMANTIC_TEXT = 'true';

    const indexName = `${INDEX_PREFIX}-incremental-rename`;
    createdIndices.push(indexName);

    const repoPath = path.join(os.tmpdir(), `test-agg-incremental-rename-${Date.now()}`);
    createdRepos.push(repoPath);
    fs.mkdirSync(repoPath, { recursive: true });
    initGitRepo(repoPath);

    const content = `function hello() {\n  console.log("world");\n}\n`;
    fs.writeFileSync(path.join(repoPath, 'old.ts'), content);
    fs.writeFileSync(path.join(repoPath, 'peer.ts'), content);
    gitCommitAll(repoPath, 'Initial');

    const repoUrl = `file://${repoPath}`;
    await setup(repoUrl, {});
    await indexRepos([`${repoUrl}:${indexName}`], { watch: false, concurrency: '2' });

    const client = getClient();
    await client.indices.refresh({ index: indexName });
    await client.indices.refresh({ index: `${indexName}_locations` });

    const chunkId = await getAnyChunkIdForNeedle({ client, indexName, needle: 'console.log("world")' });
    expect(await getFilePathsForChunkId({ client, indexName, chunkId })).toEqual(['old.ts', 'peer.ts']);

    fs.renameSync(path.join(repoPath, 'old.ts'), path.join(repoPath, 'new.ts'));
    gitCommitAll(repoPath, 'Rename old.ts -> new.ts');

    await indexRepos([`${repoUrl}:${indexName}`], { watch: false, pull: true, concurrency: '2' });
    await client.indices.refresh({ index: indexName });
    await client.indices.refresh({ index: `${indexName}_locations` });

    expect(await getFilePathsForChunkId({ client, indexName, chunkId })).toEqual(['new.ts', 'peer.ts']);
  }, 300000);

  it('should handle incremental deletes (D status) and delete doc when last location removed', async () => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';
    process.env.DISABLE_SEMANTIC_TEXT = 'true';

    const indexName = `${INDEX_PREFIX}-incremental-delete`;
    createdIndices.push(indexName);

    const repoPath = path.join(os.tmpdir(), `test-agg-incremental-delete-${Date.now()}`);
    createdRepos.push(repoPath);
    fs.mkdirSync(repoPath, { recursive: true });
    initGitRepo(repoPath);

    const content = `function hello() {\n  console.log("world");\n}\n`;
    fs.writeFileSync(path.join(repoPath, 'a.ts'), content);
    fs.writeFileSync(path.join(repoPath, 'b.ts'), content);
    gitCommitAll(repoPath, 'Initial');

    const repoUrl = `file://${repoPath}`;
    await setup(repoUrl, {});
    await indexRepos([`${repoUrl}:${indexName}`], { watch: false, concurrency: '2' });

    const client = getClient();
    await client.indices.refresh({ index: indexName });
    await client.indices.refresh({ index: `${indexName}_locations` });

    const chunkId = await getAnyChunkIdForNeedle({ client, indexName, needle: 'console.log("world")' });
    expect(await getFilePathsForChunkId({ client, indexName, chunkId })).toEqual(['a.ts', 'b.ts']);

    // Delete a.ts and run incremental.
    fs.rmSync(path.join(repoPath, 'a.ts'));
    gitCommitAll(repoPath, 'Delete a.ts');
    await indexRepos([`${repoUrl}:${indexName}`], { watch: false, pull: true, concurrency: '2' });
    await client.indices.refresh({ index: indexName });
    await client.indices.refresh({ index: `${indexName}_locations` });
    expect(await getFilePathsForChunkId({ client, indexName, chunkId })).toEqual(['b.ts']);

    // Delete b.ts and run incremental. Document should be gone.
    fs.rmSync(path.join(repoPath, 'b.ts'));
    gitCommitAll(repoPath, 'Delete b.ts');
    await indexRepos([`${repoUrl}:${indexName}`], { watch: false, pull: true, concurrency: '2' });
    await client.indices.refresh({ index: indexName });

    const afterDeleteTwo = await client.search<CodeChunk>({
      index: indexName,
      query: { match_all: {} },
      size: 200,
    });
    const docs = afterDeleteTwo.hits.hits.map((h) => h._source).filter(Boolean) as CodeChunk[];
    const remaining = docs.filter((d) => d.content.includes('console.log("world")'));
    expect(remaining.length).toBe(0);
  }, 300000);

  it('should make location documents filterable via root filePath field (non-nested KQL-friendly)', async () => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';
    process.env.DISABLE_SEMANTIC_TEXT = 'true';

    const indexName = `${INDEX_PREFIX}-root-filepath-query`;
    createdIndices.push(indexName);

    const repoPath = path.join(os.tmpdir(), `test-agg-root-filepath-${Date.now()}`);
    createdRepos.push(repoPath);
    fs.mkdirSync(repoPath, { recursive: true });
    initGitRepo(repoPath);

    const content = `function hello() {\n  console.log("world");\n}\n`;
    fs.writeFileSync(path.join(repoPath, 'alpha.ts'), content);
    fs.writeFileSync(path.join(repoPath, 'beta.ts'), content);
    gitCommitAll(repoPath, 'Initial');

    const repoUrl = `file://${repoPath}`;
    await setup(repoUrl, {});
    await indexRepos([`${repoUrl}:${indexName}`], { watch: false });

    const client = getClient();
    await client.indices.refresh({ index: `${indexName}_locations` });

    const response = await client.search({
      index: `${indexName}_locations`,
      query: {
        wildcard: {
          filePath: {
            value: '*alpha.ts',
          },
        },
      },
      size: 100,
    });

    expect(response.hits.hits.length).toBeGreaterThan(0);
    const any = response.hits.hits[0]?._source as { filePath?: unknown; chunk_id?: unknown } | undefined;
    expect(typeof any?.filePath).toBe('string');
    expect(typeof any?.chunk_id).toBe('string');
  }, 300000);

  it('should not cap locations (120 files should produce 120 locations for a chunk id)', async () => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';
    process.env.DISABLE_SEMANTIC_TEXT = 'true';

    const indexName = `${INDEX_PREFIX}-cap-100`;
    createdIndices.push(indexName);

    const repoPath = path.join(os.tmpdir(), `test-agg-cap-${Date.now()}`);
    createdRepos.push(repoPath);
    fs.mkdirSync(repoPath, { recursive: true });
    initGitRepo(repoPath);

    const content = `function hello() {\n  console.log("world");\n}\n`;
    const fileCount = 120;
    for (let i = 1; i <= fileCount; i++) {
      const name = `file${String(i).padStart(3, '0')}.ts`;
      fs.writeFileSync(path.join(repoPath, name), content);
    }
    gitCommitAll(repoPath, 'Initial');

    const repoUrl = `file://${repoPath}`;
    await setup(repoUrl, {});
    await indexRepos([`${repoUrl}:${indexName}`], { watch: false, concurrency: '2' });

    const client = getClient();
    await client.indices.refresh({ index: indexName });
    await client.indices.refresh({ index: `${indexName}_locations` });

    const chunkId = await getAnyChunkIdForNeedle({ client, indexName, needle: 'console.log("world")' });
    const locationsCount = await client.search({
      index: `${indexName}_locations`,
      query: {
        term: {
          chunk_id: chunkId,
        },
      },
      size: 0,
      track_total_hits: true,
    });
    const total =
      typeof locationsCount.hits.total === 'number'
        ? locationsCount.hits.total
        : (locationsCount.hits.total?.value ?? 0);
    expect(total).toBe(120);
  }, 300000);

  it('should isolate per-index settings (_settings) and commit hashes across multiple repos', async () => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';
    process.env.DISABLE_SEMANTIC_TEXT = 'true';

    const repoAPath = path.join(os.tmpdir(), `test-agg-settings-a-${Date.now()}`);
    const repoBPath = path.join(os.tmpdir(), `test-agg-settings-b-${Date.now()}`);
    createdRepos.push(repoAPath, repoBPath);
    fs.mkdirSync(repoAPath, { recursive: true });
    fs.mkdirSync(repoBPath, { recursive: true });
    initGitRepo(repoAPath);
    initGitRepo(repoBPath);

    fs.writeFileSync(path.join(repoAPath, 'a.ts'), 'export const a = 1;');
    const aHead1 = gitCommitAll(repoAPath, 'Initial A');
    fs.writeFileSync(path.join(repoBPath, 'b.ts'), 'export const b = 1;');
    const bHead1 = gitCommitAll(repoBPath, 'Initial B');

    const repoAUrl = `file://${repoAPath}`;
    const repoBUrl = `file://${repoBPath}`;
    const indexA = `${INDEX_PREFIX}-settings-a`;
    const indexB = `${INDEX_PREFIX}-settings-b`;
    createdIndices.push(indexA, indexB);

    await setup(repoAUrl, {});
    await indexRepos([`${repoAUrl}:${indexA}`], { watch: false });
    await setup(repoBUrl, {});
    await indexRepos([`${repoBUrl}:${indexB}`], { watch: false });

    // The index command updates settings after worker completes. Confirm each settings index stored its own HEAD.
    const commitA = await getLastIndexedCommit('main', indexA);
    const commitB = await getLastIndexedCommit('main', indexB);
    expect(commitA).toBe(aHead1);
    expect(commitB).toBe(bHead1);

    // Update only repoA and ensure indexB settings is unchanged.
    fs.writeFileSync(path.join(repoAPath, 'a.ts'), 'export const a = 2;');
    const aHead2 = gitCommitAll(repoAPath, 'Update A');
    await indexRepos([`${repoAUrl}:${indexA}`], { watch: false, pull: true });
    const commitA2 = await getLastIndexedCommit('main', indexA);
    const commitB2 = await getLastIndexedCommit('main', indexB);
    expect(commitA2).toBe(aHead2);
    expect(commitB2).toBe(bHead1);
  }, 300000);
});
