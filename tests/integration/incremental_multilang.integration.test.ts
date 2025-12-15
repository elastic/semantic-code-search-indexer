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

    // Verify initial state
    const initialSearch = await client.search<CodeChunk>({
      index: TEST_INDEX,
      query: { match_all: {} },
      size: 100,
    });

    const initialHits = initialSearch.hits.hits.map((h) => h._source!);
    expect(initialHits.length).toBeGreaterThanOrEqual(3);

    const tsFile = initialHits.find((h) => h.filePaths?.some((p) => p.path === 'main.ts') || h.filePath === 'main.ts');
    expect(tsFile).toBeDefined();
    expect(tsFile?.language).toBe('typescript');
    expect(tsFile?.content).toContain('export const x = 1');

    const pyFile = initialHits.find(
      (h) => h.filePaths?.some((p) => p.path === 'script.py') || h.filePath === 'script.py'
    );
    expect(pyFile).toBeDefined();
    expect(pyFile?.language).toBe('python');

    const goFile = initialHits.find((h) => h.filePaths?.some((p) => p.path === 'main.go') || h.filePath === 'main.go');
    expect(goFile).toBeDefined();
    expect(goFile?.language).toBe('go');

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

    // 4. Verify Final State
    const finalSearch = await client.search<CodeChunk>({
      index: TEST_INDEX,
      query: { match_all: {} },
      size: 100,
    });
    const finalHits = finalSearch.hits.hits.map((h) => h._source!);

    // Check main.ts (Modified)
    // Content-based dedupe means the updated file should point at new content,
    // and the old content should no longer be associated with the file.
    const tsFileNewContent = finalHits.find((h) => h.content.includes('export const x = 2'));
    expect(tsFileNewContent).toBeDefined();
    expect(tsFileNewContent?.filePaths?.some((p) => p.path === 'main.ts')).toBe(true);

    const tsFileOldContent = finalHits.find((h) => h.content.includes('export const x = 1'));
    expect(tsFileOldContent).toBeUndefined();

    // Check script.py (Renamed/Deleted)
    const pyFileOld = finalHits.find(
      (h) => h.filePaths?.some((p) => p.path === 'script.py') || h.filePath === 'script.py'
    );
    expect(pyFileOld).toBeUndefined();

    // Check lib.py (Renamed/Created)
    const pyFileNew = finalHits.find((h) => h.filePaths?.some((p) => p.path === 'lib.py') || h.filePath === 'lib.py');
    expect(pyFileNew).toBeDefined();
    expect(pyFileNew?.language).toBe('python');

    // Check main.go (Deleted)
    const goFileFinal = finalHits.find(
      (h) => h.filePaths?.some((p) => p.path === 'main.go') || h.filePath === 'main.go'
    );
    expect(goFileFinal).toBeUndefined();

    // Check README.md (Added)
    const mdFile = finalHits.find(
      (h) => h.filePaths?.some((p) => p.path === 'README.md') || h.filePath === 'README.md'
    );
    expect(mdFile).toBeDefined();
    expect(mdFile?.language).toBe('markdown');
  }, 300000); // 5 minute timeout
});
