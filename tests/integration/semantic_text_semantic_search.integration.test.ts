import { getClient } from '../../src/utils/elasticsearch';
import { setup } from '../../src/commands/setup_command';
import { indexRepos } from '../../src/commands/index_command';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

const TEST_INDEX = `test-semantic-text-index-${Date.now()}`;

describe('Integration Test - semantic_text retrievability via semantic queries', () => {
  let testRepoPath: string;
  let testRepoUrl: string;

  beforeAll(async () => {
    testRepoPath = path.join(os.tmpdir(), `test-semantic-text-repo-${Date.now()}`);
    fs.mkdirSync(testRepoPath, { recursive: true });

    execSync('git init', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: testRepoPath, stdio: 'ignore' });

    fs.writeFileSync(
      path.join(testRepoPath, 'README.md'),
      '# Beads\n\nThis repository contains instructions about beads and how to use bdlocal.\n'
    );
    fs.writeFileSync(path.join(testRepoPath, 'main.ts'), 'export const beads = true;');

    execSync('git add .', { cwd: testRepoPath, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath, stdio: 'ignore' });

    testRepoUrl = `file://${testRepoPath}`;
  }, 120000);

  afterAll(async () => {
    try {
      const client = getClient();
      await client.indices.delete({ index: TEST_INDEX });
      await client.indices.delete({ index: `${TEST_INDEX}_locations` });
      await client.indices.delete({ index: `${TEST_INDEX}_settings` });
    } catch {
      // ignore
    }

    if (testRepoPath && fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
  });

  it('should return hits for semantic queries when semantic_text is enabled and docs are created via index', async () => {
    // Enable semantic_text mapping (integration env defaults to DISABLE_SEMANTIC_TEXT=true).
    delete process.env.DISABLE_SEMANTIC_TEXT;
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript,markdown';

    await setup(testRepoUrl, {});
    await indexRepos([`${testRepoUrl}:${TEST_INDEX}`], { watch: false, concurrency: '2' });

    const client = getClient();
    await client.indices.refresh({ index: TEST_INDEX });

    // Retry briefly: inference can be async-ish depending on cluster state.
    let hits = 0;
    for (let i = 0; i < 5; i++) {
      const response = await client.search({
        index: TEST_INDEX,
        size: 5,
        query: {
          semantic: {
            field: 'semantic_text',
            query: 'instructions about beads',
          },
        },
        _source: ['filePath', 'content'],
      });

      hits = response.hits.hits.length;
      if (hits > 0) {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(hits).toBeGreaterThan(0);
  }, 300000);
});
