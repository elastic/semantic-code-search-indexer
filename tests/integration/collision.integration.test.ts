import { deleteDocumentsByFilePath, getClient, CodeChunk } from '../../src/utils/elasticsearch';
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

  it('should aggregate identical chunks across files into shared documents', async () => {
    // Limit to typescript
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript';

    await setup(testRepoUrl, {});
    await indexRepos([`${testRepoUrl}:${TEST_INDEX}`], { watch: false });

    const client = getClient();
    await client.indices.refresh({ index: TEST_INDEX });

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

    // Verify each document has 2 file paths
    relevantHits.forEach((hit) => {
      const doc = hit._source;
      expect(doc?.fileCount).toBe(2);
      expect(doc?.filePaths).toHaveLength(2);
      const paths = doc?.filePaths?.map((p) => p.path).sort();
      expect(paths).toEqual(['file1.ts', 'file2.ts']);
    });

    // Sanity check: ensure we found both the function and the call chunks.
    const functionChunk = relevantHits.find((h) => h._source?.content.includes('function hello'));
    const callChunk = relevantHits.find((h) => h._source?.content.trim().startsWith('console.log("world")'));
    expect(functionChunk).toBeDefined();
    expect(callChunk).toBeDefined();

    // Idempotency: running indexing again without repo changes should not duplicate filePaths entries.
    await indexRepos([`${testRepoUrl}:${TEST_INDEX}`], { watch: false });
    await client.indices.refresh({ index: TEST_INDEX });

    const responseAfterReindex = await searchAll();
    const hitsAfterReindex = responseAfterReindex.hits.hits.filter((h) =>
      h._source?.content.includes('console.log("world")')
    );
    expect(hitsAfterReindex.length).toBe(2);
    hitsAfterReindex.forEach((hit) => {
      const doc = hit._source;
      expect(doc?.fileCount).toBe(2);
      expect(doc?.filePaths).toHaveLength(2);
      const unique = new Set((doc?.filePaths ?? []).map((p) => `${p.path}:${p.startLine}`));
      expect(unique.size).toBe(2);
    });

    // Partial removal: deleting one file should remove only that path from aggregated documents.
    await deleteDocumentsByFilePath('file1.ts', TEST_INDEX);
    await client.indices.refresh({ index: TEST_INDEX });

    const responseAfterDelete1 = await searchAll();
    const hitsAfterDelete1 = responseAfterDelete1.hits.hits.filter((h) =>
      h._source?.content.includes('console.log("world")')
    );
    expect(hitsAfterDelete1.length).toBe(2);
    hitsAfterDelete1.forEach((hit) => {
      const doc = hit._source;
      expect(doc?.fileCount).toBe(1);
      expect(doc?.filePaths).toHaveLength(1);
      expect(doc?.filePaths?.[0]?.path).toBe('file2.ts');
    });

    // Final removal: deleting the last remaining path should delete the document entirely.
    await deleteDocumentsByFilePath('file2.ts', TEST_INDEX);
    await client.indices.refresh({ index: TEST_INDEX });

    const responseAfterDelete2 = await searchAll();
    const hitsAfterDelete2 = responseAfterDelete2.hits.hits.filter((h) =>
      h._source?.content.includes('console.log("world")')
    );
    expect(hitsAfterDelete2.length).toBe(0);
  }, 180000);
});
