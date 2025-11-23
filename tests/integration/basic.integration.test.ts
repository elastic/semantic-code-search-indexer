import { client } from '../../src/utils/elasticsearch';
import { setup } from '../../src/commands/setup_command';
import { indexRepos } from '../../src/commands/index_command';
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

const TEST_REPO_URL = 'https://github.com/elastic/semantic-code-search-indexer.git';
const TEST_INDEX = `test-integration-index-${Date.now()}`;

describe('Integration Test', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  afterAll(async () => {
    try {
      await client.indices.delete({ index: TEST_INDEX });
      await client.indices.delete({ index: `${TEST_INDEX}_settings` });
    } catch {}
  });

  it('should setup, index, and verify only markdown documents in elasticsearch', async () => {
    delete process.env.SEMANTIC_CODE_INDEXER_LANGUAGES;
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'markdown';

    await setup(TEST_REPO_URL, {});
    await indexRepos([`${TEST_REPO_URL}:${TEST_INDEX}`], {});
    const response = await client.count({ index: TEST_INDEX });

    expect(response.count).toBeGreaterThan(0);
  }, 180000);
});
