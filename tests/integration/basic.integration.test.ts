import { client } from '../../src/utils/elasticsearch';
import { setup } from '../../src/commands/setup_command';
import { indexRepos } from '../../src/commands/index_command';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

const TEST_INDEX = `test-integration-index-${Date.now()}`;

// Check if Elasticsearch is available
async function isElasticsearchAvailable(): Promise<boolean> {
  try {
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

describe('Integration Test - Full Indexing Pipeline', () => {
  let testRepoPath: string;
  let testRepoUrl: string;

  beforeAll(async () => {
    // Check ES availability first
    const esAvailable = await isElasticsearchAvailable();
    if (!esAvailable) {
      throw new Error(
        'Elasticsearch is not available. Run `npm run test:integration:setup` first to start Elasticsearch via Docker Compose.'
      );
    }

    // Create a temporary Git repository from fixtures for testing
    testRepoPath = path.join(os.tmpdir(), `test-tiny-repo-${Date.now()}`);
    fs.mkdirSync(testRepoPath, { recursive: true });

    // Copy fixtures to test repo
    const fixturesDir = path.resolve(__dirname, '../fixtures');
    fs.cpSync(fixturesDir, testRepoPath, { recursive: true });

    // Initialize as git repo
    execSync('git init', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git add .', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath, stdio: 'ignore' });

    testRepoUrl = `file://${testRepoPath}`;
  });

  afterAll(async () => {
    // Clean up test index
    try {
      await client.indices.delete({ index: TEST_INDEX });
      await client.indices.delete({ index: `${TEST_INDEX}_settings` });
    } catch {
      // Ignore errors during cleanup
    }

    // Clean up test repo
    if (testRepoPath && fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
  });

  it('should setup, index, and verify documents in elasticsearch', async () => {
    // Limit to markdown for faster test execution
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'markdown';

    // Setup creates the index with proper mapping
    await setup(testRepoUrl, {});

    // Index the test repository with watch: false to prevent infinite loops
    await indexRepos([`${testRepoUrl}:${TEST_INDEX}`], { watch: false });

    // Force Elasticsearch to refresh the index to make documents searchable
    await client.indices.refresh({ index: TEST_INDEX });

    // Verify documents were indexed
    const response = await client.count({ index: TEST_INDEX });

    expect(response.count).toBeGreaterThan(0);
  }, 180000); // 3 minute timeout
});
