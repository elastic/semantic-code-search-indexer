import { getClient, CodeChunk } from '../../src/utils/elasticsearch';
import { setup } from '../../src/commands/setup_command';
import { indexRepos } from '../../src/commands/index_command';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

const TEST_INDEX = `test-incremental-index-${Date.now()}`;

async function isElasticsearchAvailable(): Promise<boolean> {
  try {
    await getClient().ping();
    return true;
  } catch {
    return false;
  }
}

function assertIsString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected "${name}" to be a non-empty string`);
  }
}

describe('Integration Test - Incremental Indexing & Multi-language Support', () => {
  let testRepoPath: string;
  let testRepoUrl: string;

  beforeAll(async () => {
    const esAvailable = await isElasticsearchAvailable();
    if (!esAvailable) {
      throw new Error(
        'Elasticsearch is not available. Run `npm run test:integration:setup` first to start Elasticsearch via Docker Compose.'
      );
    }

    testRepoPath = path.join(os.tmpdir(), `test-incremental-repo-${Date.now()}`);
    fs.mkdirSync(testRepoPath, { recursive: true });

    // Initialize git repo
    execSync('git init', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: testRepoPath, stdio: 'ignore' });

    // Step 1: Initial files with multiple languages
    fs.writeFileSync(path.join(testRepoPath, 'main.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(testRepoPath, 'script.py'), 'def hello():\n    pass');
    fs.writeFileSync(path.join(testRepoPath, 'main.go'), 'package main\nfunc main() {}');

    execSync('git add .', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath, stdio: 'ignore' });

    testRepoUrl = `file://${testRepoPath}`;
  });

  afterAll(async () => {
    try {
      const client = getClient();
      await client.indices.delete({ index: TEST_INDEX });
      await client.indices.delete({ index: `${TEST_INDEX}_locations` });
      await client.indices.delete({ index: `${TEST_INDEX}_settings` });
    } catch {
      // Ignore errors during cleanup
    }

    if (testRepoPath && fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
  });

  it('should handle full index, then incremental updates with mixed languages', async () => {
    // Enable all languages we are testing
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript,python,go,markdown';

    // 1. Initial Setup and Full Index
    await setup(testRepoUrl, {});
    await indexRepos([`${testRepoUrl}:${TEST_INDEX}`], { watch: false });

    const client = getClient();
    await client.indices.refresh({ index: TEST_INDEX });
    await client.indices.refresh({ index: `${TEST_INDEX}_locations` });

    // Verify initial state
    const tsHit = await client.search<CodeChunk>({
      index: TEST_INDEX,
      query: { match: { content: 'const x = 1' } },
      size: 10,
    });
    const tsOldId = tsHit.hits.hits.find((h) => h._source?.language === 'typescript')?._id;
    assertIsString(tsOldId, 'tsOldId');
    const tsLocations = await client.search({
      index: `${TEST_INDEX}_locations`,
      query: { bool: { must: [{ term: { chunk_id: tsOldId } }, { term: { filePath: 'main.ts' } }] } },
      size: 1,
    });
    expect(tsLocations.hits.hits.length).toBe(1);

    const pyHit = await client.search<CodeChunk>({
      index: TEST_INDEX,
      query: { match: { content: 'def hello' } },
      size: 10,
    });
    const pyId = pyHit.hits.hits.find((h) => h._source?.language === 'python')?._id;
    assertIsString(pyId, 'pyId');
    const pyLocations = await client.search({
      index: `${TEST_INDEX}_locations`,
      query: { bool: { must: [{ term: { chunk_id: pyId } }, { term: { filePath: 'script.py' } }] } },
      size: 1,
    });
    expect(pyLocations.hits.hits.length).toBe(1);

    const goHit = await client.search<CodeChunk>({
      index: TEST_INDEX,
      query: { match: { content: 'package main' } },
      size: 10,
    });
    const goId = goHit.hits.hits.find((h) => h._source?.language === 'go')?._id;
    assertIsString(goId, 'goId');
    const goLocations = await client.search({
      index: `${TEST_INDEX}_locations`,
      query: { bool: { must: [{ term: { chunk_id: goId } }, { term: { filePath: 'main.go' } }] } },
      size: 1,
    });
    expect(goLocations.hits.hits.length).toBe(1);

    // 2. Make Incremental Changes
    // - Modify main.ts
    // - Rename script.py -> lib.py
    // - Delete main.go
    // - Add README.md

    fs.writeFileSync(path.join(testRepoPath, 'main.ts'), 'export const x = 2; // Modified');
    fs.renameSync(path.join(testRepoPath, 'script.py'), path.join(testRepoPath, 'lib.py'));
    fs.rmSync(path.join(testRepoPath, 'main.go'));
    fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Test Repo\nThis is a test.');

    execSync('git add .', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git commit -m "Incremental changes"', { cwd: testRepoPath, stdio: 'ignore' });

    // 3. Run Incremental Index
    // indexRepos will verify the commit hash in _settings and switch to incremental mode
    // We MUST set pull: true to ensure the local clone updates from our "remote" test repo
    await indexRepos([`${testRepoUrl}:${TEST_INDEX}`], { watch: false, pull: true });
    await client.indices.refresh({ index: TEST_INDEX });
    await client.indices.refresh({ index: `${TEST_INDEX}_locations` });

    // 4. Verify Final State
    const finalSearch = await client.search<CodeChunk>({
      index: TEST_INDEX,
      query: { match_all: {} },
      size: 100,
    });
    const finalHits = finalSearch.hits.hits.flatMap((h) => (h._source ? [h._source] : []));

    // Check main.ts (Modified)
    // Content-based dedupe means the updated file should point at new content,
    // and the old content should no longer be associated with the file.
    const tsFileNewContent = finalHits.find((h) => h.content.includes('const x = 2'));
    expect(tsFileNewContent).toBeDefined();
    const tsNewId = finalSearch.hits.hits.find((h) => h._source?.content.includes('const x = 2'))?._id;
    assertIsString(tsNewId, 'tsNewId');
    const tsNewLocations = await client.search({
      index: `${TEST_INDEX}_locations`,
      query: { bool: { must: [{ term: { chunk_id: tsNewId } }, { term: { filePath: 'main.ts' } }] } },
      size: 1,
    });
    expect(tsNewLocations.hits.hits.length).toBe(1);

    // Ensure the old content is no longer associated with main.ts in the locations index.
    const tsOldLocationsFinal = await client.search({
      index: `${TEST_INDEX}_locations`,
      query: { bool: { must: [{ term: { chunk_id: tsOldId } }, { term: { filePath: 'main.ts' } }] } },
      size: 1,
    });
    expect(tsOldLocationsFinal.hits.hits.length).toBe(0);

    const tsFileOldContent = finalHits.find((h) => h.content.includes('const x = 1'));
    expect(tsFileOldContent).toBeUndefined();

    // Check script.py (Renamed/Deleted)
    const scriptLocations = await client.search({
      index: `${TEST_INDEX}_locations`,
      query: { term: { filePath: 'script.py' } },
      size: 1,
    });
    expect(scriptLocations.hits.hits.length).toBe(0);

    // Check lib.py (Renamed/Created)
    const libLocations = await client.search({
      index: `${TEST_INDEX}_locations`,
      query: { term: { filePath: 'lib.py' } },
      size: 1,
    });
    expect(libLocations.hits.hits.length).toBeGreaterThan(0);

    // Check main.go (Deleted)
    const goLocationsFinal = await client.search({
      index: `${TEST_INDEX}_locations`,
      query: { term: { filePath: 'main.go' } },
      size: 1,
    });
    expect(goLocationsFinal.hits.hits.length).toBe(0);

    // Check README.md (Added)
    const mdHit = await client.search<CodeChunk>({
      index: TEST_INDEX,
      query: { match: { content: 'Test Repo' } },
      size: 10,
    });
    const mdId = mdHit.hits.hits.find((h) => h._source?.language === 'markdown')?._id;
    assertIsString(mdId, 'mdId');
    const mdLocations = await client.search({
      index: `${TEST_INDEX}_locations`,
      query: { bool: { must: [{ term: { chunk_id: mdId } }, { term: { filePath: 'README.md' } }] } },
      size: 1,
    });
    expect(mdLocations.hits.hits.length).toBe(1);
  }, 300000); // 5 minute timeout
});
