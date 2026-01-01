import { getClient } from '../../src/utils/elasticsearch';
import { setup } from '../../src/commands/setup_command';
import { indexRepos } from '../../src/commands/index_command';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

const TEST_INDEX = `test-batching-index-${Date.now()}`;

// Check if Elasticsearch is available
async function isElasticsearchAvailable(): Promise<boolean> {
  try {
    await getClient().ping();
    return true;
  } catch {
    return false;
  }
}

describe('Integration Test - Queue Batching Stability', () => {
  let testRepoPath: string;
  let testRepoUrl: string;
  let originalBatchSize: string | undefined;

  beforeAll(async () => {
    const esAvailable = await isElasticsearchAvailable();
    if (!esAvailable) {
      throw new Error(
        'Elasticsearch is not available. Run `npm run test:integration:setup` first to start Elasticsearch via Docker Compose.'
      );
    }

    testRepoPath = path.join(os.tmpdir(), `test-batching-repo-${Date.now()}`);
    fs.mkdirSync(testRepoPath, { recursive: true });

    // Initialize as git repo
    execSync('git init', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: testRepoPath, stdio: 'ignore' });

    // Create a large file to generate > 1000 chunks
    // Default chunk size is ~15 lines.
    // 1500 chunks * 15 lines = 22,500 lines.
    const repeatedContent = `
function testFunction(i: number) {
  console.log("This is a test function " + i);
  return i * 2;
}
`;
    let fileContent = '';
    for (let i = 0; i < 2500; i++) {
      fileContent += repeatedContent.replace('testFunction', `testFunction${i}`);
    }

    fs.writeFileSync(path.join(testRepoPath, 'large_file.ts'), fileContent);

    execSync('git add .', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath, stdio: 'ignore' });

    testRepoUrl = `file://${testRepoPath}`;

    // Override BATCH_SIZE
    originalBatchSize = process.env.BATCH_SIZE;
    process.env.BATCH_SIZE = '1200'; // Set > 999 to trigger potential SQLite limits if not handled
  });

  afterAll(async () => {
    // Restore env var
    if (originalBatchSize) {
      process.env.BATCH_SIZE = originalBatchSize;
    } else {
      delete process.env.BATCH_SIZE;
    }

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

  it('should process a large batch of documents without exceeding SQLite limits', async () => {
    // Limit to typescript
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';

    await setup(testRepoUrl, {});
    await indexRepos([`${testRepoUrl}:${TEST_INDEX}`], { watch: false });

    const client = getClient();
    await client.indices.refresh({ index: TEST_INDEX });

    const response = await client.count({ index: TEST_INDEX });

    // We expect > 1000 documents
    expect(response.count).toBeGreaterThan(1000);

    // Check for success log (implied by execution finishing without error, but we can check internal metrics if exposed)
    // The main assertion here is that indexRepos didn't throw and we have docs.
  }, 300000); // 5 minute timeout for large file
});
