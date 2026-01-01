import { deleteDocumentsByFilePath, getClient, indexCodeChunks, CodeChunk } from '../../src/utils/elasticsearch';
import { setup } from '../../src/commands/setup_command';
import { indexRepos } from '../../src/commands/index_command';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { LanguageParser } from '../../src/utils/parser';

const TEST_INDEX = `test-collision-index-${Date.now()}`;

// Check if Elasticsearch is available
async function isElasticsearchAvailable(): Promise<boolean> {
  try {
    await getClient().ping();
    return true;
  } catch {
    return false;
  }
}

describe('Integration Test - Collision Handling', () => {
  let testRepoPath: string;
  let testRepoUrl: string;
  let manyFilesRepoPath: string;
  let manyFilesRepoUrl: string;

  beforeAll(async () => {
    const esAvailable = await isElasticsearchAvailable();
    if (!esAvailable) {
      throw new Error(
        'Elasticsearch is not available. Run `npm run test:integration:setup` first to start Elasticsearch via Docker Compose.'
      );
    }

    testRepoPath = path.join(os.tmpdir(), `test-collision-repo-${Date.now()}`);
    fs.mkdirSync(testRepoPath, { recursive: true });

    // Initialize as git repo
    execSync('git init', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: testRepoPath, stdio: 'ignore' });

    // Create two files with IDENTICAL content
    const content = `
      function hello() {
        console.log("world");
      }
    `;
    fs.writeFileSync(path.join(testRepoPath, 'file1.ts'), content);
    fs.writeFileSync(path.join(testRepoPath, 'file2.ts'), content);

    execSync('git add .', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath, stdio: 'ignore' });

    testRepoUrl = `file://${testRepoPath}`;

    // Create a second repo with many identical files to force multiple dequeue batches
    // and exercise worker concurrency safely.
    manyFilesRepoPath = path.join(os.tmpdir(), `test-collision-many-files-repo-${Date.now()}`);
    fs.mkdirSync(manyFilesRepoPath, { recursive: true });

    execSync('git init', { cwd: manyFilesRepoPath, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: manyFilesRepoPath, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: manyFilesRepoPath, stdio: 'ignore' });

    const sharedContent = `
      function hello() {
        console.log("world");
      }
    `;

    const fileCount = 30;
    for (let i = 0; i < fileCount; i++) {
      fs.writeFileSync(path.join(manyFilesRepoPath, `file${i + 1}.ts`), sharedContent);
    }

    execSync('git add .', { cwd: manyFilesRepoPath, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: manyFilesRepoPath, stdio: 'ignore' });
    manyFilesRepoUrl = `file://${manyFilesRepoPath}`;
  }, 120000);

  afterAll(async () => {
    try {
      const client = getClient();
      await client.indices.delete({ index: TEST_INDEX });
      await client.indices.delete({ index: `${TEST_INDEX}_locations` });
      await client.indices.delete({ index: `${TEST_INDEX}_settings` });
      await client.indices.delete({ index: `${TEST_INDEX}-many` });
      await client.indices.delete({ index: `${TEST_INDEX}-many_locations` });
      await client.indices.delete({ index: `${TEST_INDEX}-many_settings` });
    } catch {
      // Ignore errors during cleanup
    }

    if (testRepoPath && fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }

    if (manyFilesRepoPath && fs.existsSync(manyFilesRepoPath)) {
      fs.rmSync(manyFilesRepoPath, { recursive: true, force: true });
    }
  });

  it('should aggregate identical chunks across files into shared documents', async () => {
    // Limit to typescript
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';

    await setup(testRepoUrl, {});
    await indexRepos([`${testRepoUrl}:${TEST_INDEX}`], { watch: false, concurrency: '2' });

    const client = getClient();
    await client.indices.refresh({ index: TEST_INDEX });
    await client.indices.refresh({ index: `${TEST_INDEX}_locations` });
    await client.indices.refresh({ index: `${TEST_INDEX}_locations` });

    const searchAll = async () => {
      return client.search<CodeChunk>({
        index: TEST_INDEX,
        query: {
          match_all: {},
        },
        size: 100,
      });
    };

    const response = await searchAll();

    const hits = response.hits.hits;

    // We expect the TypeScript parser to produce at least:
    // - a `function_declaration` chunk (contains the console.log call)
    // - a `call_expression` chunk (the console.log call itself)
    // Both chunks should be aggregated across the 2 files.
    const relevantHits = hits.filter((h) => h._source?.content.includes('console.log("world")'));
    expect(relevantHits.length).toBe(2);

    // Verify each chunk id has 2 locations (file1.ts + file2.ts)
    for (const hit of relevantHits) {
      const chunkId = hit._id;
      const locations = await client.search({
        index: `${TEST_INDEX}_locations`,
        query: { term: { chunk_id: chunkId } },
        size: 10,
        _source: ['filePath'],
      });
      const paths = locations.hits.hits
        .map((h) => (h._source as { filePath?: string } | undefined)?.filePath)
        .filter((p): p is string => typeof p === 'string')
        .slice()
        .sort();
      expect(paths).toEqual(['file1.ts', 'file2.ts']);
    }

    // Sanity check: ensure we found both the function and the call chunks.
    const functionChunk = relevantHits.find((h) => h._source?.content.includes('function hello'));
    const callChunk = relevantHits.find((h) => h._source?.content.trim().startsWith('console.log("world")'));
    expect(functionChunk).toBeDefined();
    expect(callChunk).toBeDefined();

    // Locations store sanity check: at least one location should be stored for file1.ts.
    const locationsForFile1 = await client.search({
      index: `${TEST_INDEX}_locations`,
      query: {
        term: { filePath: 'file1.ts' },
      },
      size: 1,
    });
    expect(locationsForFile1.hits.hits.length).toBeGreaterThan(0);

    // Idempotency: running indexing again without repo changes should not duplicate filePaths entries.
    await indexRepos([`${testRepoUrl}:${TEST_INDEX}`], { watch: false, concurrency: '2' });
    await client.indices.refresh({ index: TEST_INDEX });
    await client.indices.refresh({ index: `${TEST_INDEX}_locations` });

    const responseAfterReindex = await searchAll();
    const hitsAfterReindex = responseAfterReindex.hits.hits.filter((h) =>
      h._source?.content.includes('console.log("world")')
    );
    expect(hitsAfterReindex.length).toBe(2);
    for (const hit of hitsAfterReindex) {
      const chunkId = hit._id;
      const locations = await client.search({
        index: `${TEST_INDEX}_locations`,
        query: { term: { chunk_id: chunkId } },
        size: 10,
        _source: ['filePath'],
      });
      const paths = locations.hits.hits
        .map((h) => (h._source as { filePath?: string } | undefined)?.filePath)
        .filter((p): p is string => typeof p === 'string')
        .slice()
        .sort();
      expect(paths).toEqual(['file1.ts', 'file2.ts']);
    }

    // Partial removal: deleting one file should remove only that path from aggregated documents.
    await deleteDocumentsByFilePath('file1.ts', TEST_INDEX);
    await client.indices.refresh({ index: TEST_INDEX });
    await client.indices.refresh({ index: `${TEST_INDEX}_locations` });

    const responseAfterDelete1 = await searchAll();
    const hitsAfterDelete1 = responseAfterDelete1.hits.hits.filter((h) =>
      h._source?.content.includes('console.log("world")')
    );
    expect(hitsAfterDelete1.length).toBe(2);
    for (const hit of hitsAfterDelete1) {
      const chunkId = hit._id;
      const locations = await client.search({
        index: `${TEST_INDEX}_locations`,
        query: { term: { chunk_id: chunkId } },
        size: 10,
        _source: ['filePath'],
      });
      const paths = locations.hits.hits
        .map((h) => (h._source as { filePath?: string } | undefined)?.filePath)
        .filter((p): p is string => typeof p === 'string')
        .slice()
        .sort();
      expect(paths).toEqual(['file2.ts']);
    }

    // Locations store must have removed file1.ts entries.
    const remainingLocationsForFile1 = await client.search({
      index: `${TEST_INDEX}_locations`,
      query: {
        term: { filePath: 'file1.ts' },
      },
      size: 1,
    });
    expect(remainingLocationsForFile1.hits.hits.length).toBe(0);

    // Final removal: deleting the last remaining path should delete the document entirely.
    await deleteDocumentsByFilePath('file2.ts', TEST_INDEX);
    await client.indices.refresh({ index: TEST_INDEX });
    await client.indices.refresh({ index: `${TEST_INDEX}_locations` });

    const responseAfterDelete2 = await searchAll();
    const hitsAfterDelete2 = responseAfterDelete2.hits.hits.filter((h) =>
      h._source?.content.includes('console.log("world")')
    );
    expect(hitsAfterDelete2.length).toBe(0);
  }, 180000);

  it('should work on semantic_text indices that reject scripted updates', async () => {
    // Ensure semantic_text field exists in the mapping (default behavior).
    delete process.env.DISABLE_SEMANTIC_TEXT;
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';

    await setup(testRepoUrl, {});
    await indexRepos([`${testRepoUrl}:${TEST_INDEX}`], { watch: false, concurrency: '2' });

    const client = getClient();
    await client.indices.refresh({ index: TEST_INDEX });

    // Current behavior we care about:
    // when semantic_text is enabled in the index mapping, indexing and file-path deletions succeed.
    const parser = new LanguageParser();
    const filePath = path.join(testRepoPath, 'file1.ts');
    const parsed = parser.parseFile(filePath, 'main', 'file1.ts');
    expect(parsed.chunks.length).toBeGreaterThan(0);

    const firstChunk = parsed.chunks[0]!;
    const res = await indexCodeChunks([firstChunk], TEST_INDEX);
    expect(res.failed).toHaveLength(0);
    expect(res.succeeded).toHaveLength(1);

    await deleteDocumentsByFilePath('file1.ts', TEST_INDEX);
    await client.indices.refresh({ index: TEST_INDEX });
    await client.indices.refresh({ index: `${TEST_INDEX}_locations` });
  }, 180000);

  it('should not lose locations under worker concurrency across many identical files', async () => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';
    delete process.env.DISABLE_SEMANTIC_TEXT;

    await setup(manyFilesRepoUrl, {});
    // Run with higher worker concurrency to force multiple in-flight dequeue batches.
    const manyIndexName = `${TEST_INDEX}-many`;
    await indexRepos([`${manyFilesRepoUrl}:${manyIndexName}`], { watch: false, concurrency: '4' });

    const client = getClient();
    await client.indices.refresh({ index: manyIndexName });
    await client.indices.refresh({ index: `${manyIndexName}_locations` });

    const response = await client.search<CodeChunk>({
      index: manyIndexName,
      query: { match_all: {} },
      size: 500,
    });

    const hits = response.hits.hits;
    const relevantHits = hits.filter((h) => h._source?.content.includes('console.log("world")'));

    // Expect at least the function declaration chunk and call expression chunk.
    expect(relevantHits.length).toBeGreaterThanOrEqual(2);

    // Every relevant chunk id should retain all file locations in the locations store.
    const expectedFiles = Array.from({ length: 30 }, (_, i) => `file${i + 1}.ts`).sort();
    for (const hit of relevantHits) {
      const chunkId = hit._id;
      const locations = await client.search({
        index: `${manyIndexName}_locations`,
        query: { term: { chunk_id: chunkId } },
        size: 100,
        _source: ['filePath'],
      });
      const paths = locations.hits.hits
        .map((h) => (h._source as { filePath?: string } | undefined)?.filePath)
        .filter((p): p is string => typeof p === 'string')
        .slice()
        .sort();
      expect(paths).toEqual(expectedFiles);
    }
  }, 180000);
});
