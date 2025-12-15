import { getClient, CodeChunk } from '../../src/utils/elasticsearch';
import { setup } from '../../src/commands/setup_command';
import { indexRepos } from '../../src/commands/index_command';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

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

  it('should index identical content from different files as separate documents', async () => {
    // Limit to typescript
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';

    await setup(testRepoUrl, {});
    await indexRepos([`${testRepoUrl}:${TEST_INDEX}`], { watch: false });

    const client = getClient();
    await client.indices.refresh({ index: TEST_INDEX });

    // We expect at least 2 documents (one for each file)
    // There might be more depending on chunking, but we at least want to ensure both files are represented
    const response = await client.search<CodeChunk>({
      index: TEST_INDEX,
      query: {
        match_all: {},
      },
      size: 100,
    });

    const hits = response.hits.hits;
    const filePaths = hits.map((hit) => hit._source?.filePath);

    expect(filePaths).toContain('file1.ts');
    expect(filePaths).toContain('file2.ts');

    // Ensure distinct IDs
    const ids = hits.map((hit) => hit._id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    // Verify content is correct
    const content = hits.map((hit) => hit._source?.content);
    expect(content.some((c) => c && c.includes('console.log("world")'))).toBe(true);
  }, 180000);
});
