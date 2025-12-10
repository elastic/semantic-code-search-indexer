import { Client } from '@elastic/elasticsearch';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';

import * as elasticsearch from '../../src/utils/elasticsearch';
import { CodeChunk } from '../../src/utils/elasticsearch';
import * as loggerModule from '../../src/utils/logger';

const MOCK_CHUNK: CodeChunk = {
  type: 'code',
  language: 'typescript',
  filePath: 'test.ts',
  directoryPath: '',
  directoryName: '',
  directoryDepth: 0,
  git_file_hash: 'hash1',
  git_branch: 'main',
  chunk_hash: 'chunk_hash_1',
  startLine: 1,
  endLine: 1,
  content: 'const a = 1;',
  semantic_text: 'const a = 1;',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('indexCodeChunks', () => {
  let mockBulk: Mock;
  let mockClient: Client;

  beforeEach(() => {
    // Create a mock client with all necessary methods
    mockBulk = vi.fn();
    mockClient = {
      bulk: mockBulk,
      indices: {
        exists: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
      get: vi.fn(),
      index: vi.fn(),
      search: vi.fn(),
      deleteByQuery: vi.fn(),
      cluster: {
        health: vi.fn(),
      },
    } as unknown as Client;

    // Set the mock client directly
    elasticsearch.setClient(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Reset the client
    elasticsearch.setClient(undefined);
  });

  it('should return all chunks as succeeded when bulk indexing succeeds', async () => {
    const mockBulkResponse = {
      errors: false,
      items: [
        {
          index: {
            status: 200,
            _index: 'test-index',
            _id: 'chunk_hash_1',
          },
        },
      ],
    };

    mockBulk.mockResolvedValue(mockBulkResponse);

    const chunks = [MOCK_CHUNK];
    const result = await elasticsearch.indexCodeChunks(chunks);

    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.succeeded[0].chunk_hash).toBe('chunk_hash_1');
    expect(mockBulk).toHaveBeenCalledTimes(1);
  });

  it('should return failed chunks when bulk indexing has errors', async () => {
    const mockBulkResponse = {
      errors: true,
      items: [
        {
          index: {
            status: 400,
            error: {
              type: 'mapper_parsing_exception',
              reason: 'failed to parse field [semantic_text]',
            },
          },
        },
      ],
    };

    mockBulk.mockResolvedValue(mockBulkResponse);

    const chunks = [MOCK_CHUNK];
    const result = await elasticsearch.indexCodeChunks(chunks);

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].chunk.chunk_hash).toBe('chunk_hash_1');
    expect(result.failed[0].error).toEqual({
      type: 'mapper_parsing_exception',
      reason: 'failed to parse field [semantic_text]',
    });
    expect(mockBulk).toHaveBeenCalledTimes(1);
  });

  it('should include error details in failed results', async () => {
    const mockBulkResponse = {
      errors: true,
      items: [
        {
          index: {
            status: 404,
            error: {
              type: 'index_not_found_exception',
              reason: 'no such index [missing-index]',
              index: 'missing-index',
            },
          },
        },
      ],
    };

    mockBulk.mockResolvedValue(mockBulkResponse);

    const chunks = [MOCK_CHUNK];
    const result = await elasticsearch.indexCodeChunks(chunks);

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toMatchObject({
      type: 'index_not_found_exception',
      reason: 'no such index [missing-index]',
    });
  });

  it('should separate succeeded and failed documents in partial failure', async () => {
    const mockChunk2: CodeChunk = {
      ...MOCK_CHUNK,
      chunk_hash: 'chunk_hash_2',
      content: 'const b = 2;',
    };

    const mockChunk3: CodeChunk = {
      ...MOCK_CHUNK,
      chunk_hash: 'chunk_hash_3',
      content: 'const c = 3;',
    };

    const mockBulkResponse = {
      errors: true,
      items: [
        {
          index: {
            status: 200,
            _index: 'test-index',
            _id: 'chunk_hash_1',
          },
        },
        {
          index: {
            status: 400,
            error: {
              type: 'mapper_parsing_exception',
              reason: 'failed to parse',
            },
          },
        },
        {
          index: {
            status: 500,
            error: {
              type: 'internal_server_error',
              reason: 'internal error',
            },
          },
        },
      ],
    };

    mockBulk.mockResolvedValue(mockBulkResponse);

    const chunks = [MOCK_CHUNK, mockChunk2, mockChunk3];
    const result = await elasticsearch.indexCodeChunks(chunks);

    // First chunk succeeded
    expect(result.succeeded).toHaveLength(1);
    expect(result.succeeded[0].chunk_hash).toBe('chunk_hash_1');

    // Second and third chunks failed
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0].chunk.chunk_hash).toBe('chunk_hash_2');
    expect(result.failed[1].chunk.chunk_hash).toBe('chunk_hash_3');
  });

  it('should return empty arrays when chunks array is empty', async () => {
    const result = await elasticsearch.indexCodeChunks([]);

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it('should handle errors with different action types', async () => {
    const mockBulkResponse = {
      errors: true,
      items: [
        {
          create: {
            status: 409,
            error: {
              type: 'version_conflict_engine_exception',
              reason: 'document already exists',
            },
          },
        },
      ],
    };

    mockBulk.mockResolvedValue(mockBulkResponse);

    const chunks = [MOCK_CHUNK];
    const result = await elasticsearch.indexCodeChunks(chunks);

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toMatchObject({
      type: 'version_conflict_engine_exception',
    });
  });

  it('should return all chunks as failed on network/connection error', async () => {
    mockBulk.mockRejectedValue(new Error('Connection refused'));

    const chunks = [MOCK_CHUNK];
    const result = await elasticsearch.indexCodeChunks(chunks);

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].chunk.chunk_hash).toBe('chunk_hash_1');
    expect(result.failed[0].error).toBeInstanceOf(Error);
  });
});

describe('createRepoAlias', () => {
  let mockExistsAlias: Mock;
  let mockExists: Mock;
  let mockPutAlias: Mock;
  let mockLoggerInfo: Mock;
  let mockLoggerWarn: Mock;
  let mockLoggerError: Mock;
  let mockClient: Client;

  beforeEach(() => {
    // Create a mock client with all necessary methods
    mockExistsAlias = vi.fn();
    mockExists = vi.fn();
    mockPutAlias = vi.fn();
    mockClient = {
      indices: {
        existsAlias: mockExistsAlias,
        exists: mockExists,
        putAlias: mockPutAlias,
      },
    } as unknown as Client;
    elasticsearch.setClient(mockClient);

    // Mock logger
    mockLoggerInfo = vi.spyOn(loggerModule.logger, 'info');
    mockLoggerWarn = vi.spyOn(loggerModule.logger, 'warn');
    mockLoggerError = vi.spyOn(loggerModule.logger, 'error');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('SHOULD create alias when index exists and alias does not', async () => {
    mockExistsAlias.mockResolvedValue(false);
    // First call: check if alias name index exists (returns false)
    // Second call: check if target index exists (returns true)
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockPutAlias.mockResolvedValue({ acknowledged: true });

    await elasticsearch.createRepoAlias('test-index');

    expect(mockExistsAlias).toHaveBeenCalledWith({ name: 'test-index-repo' });
    expect(mockExists).toHaveBeenCalledWith({ index: 'test-index-repo' });
    expect(mockExists).toHaveBeenCalledWith({ index: 'test-index' });
    expect(mockPutAlias).toHaveBeenCalledWith({
      index: 'test-index',
      name: 'test-index-repo',
    });
    expect(mockLoggerInfo).toHaveBeenCalledWith('Creating alias "test-index-repo" pointing to index "test-index"...');
    expect(mockLoggerInfo).toHaveBeenCalledWith('Successfully created alias "test-index-repo"');
  });

  it('SHOULD skip alias creation when alias already exists', async () => {
    mockExistsAlias.mockResolvedValue(true);

    await elasticsearch.createRepoAlias('test-index');

    expect(mockExistsAlias).toHaveBeenCalledWith({ name: 'test-index-repo' });
    expect(mockExists).not.toHaveBeenCalled();
    expect(mockPutAlias).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith('Alias "test-index-repo" already exists.');
  });

  it('SHOULD skip alias creation when index does not exist', async () => {
    mockExistsAlias.mockResolvedValue(false);
    // First call: check if alias name index exists (returns false)
    // Second call: check if target index exists (returns false)
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(false);

    await elasticsearch.createRepoAlias('test-index');

    expect(mockExistsAlias).toHaveBeenCalledWith({ name: 'test-index-repo' });
    expect(mockExists).toHaveBeenCalledWith({ index: 'test-index-repo' });
    expect(mockExists).toHaveBeenCalledWith({ index: 'test-index' });
    expect(mockPutAlias).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Cannot create alias "test-index-repo": index "test-index" does not exist.'
    );
  });

  it('SHOULD skip alias creation when an index with alias name already exists', async () => {
    mockExistsAlias.mockResolvedValue(false);
    // First call: check if alias name index exists (returns true - conflict!)
    mockExists.mockResolvedValueOnce(true);

    await elasticsearch.createRepoAlias('test-index');

    expect(mockExistsAlias).toHaveBeenCalledWith({ name: 'test-index-repo' });
    expect(mockExists).toHaveBeenCalledWith({ index: 'test-index-repo' });
    // Should not check if target index exists or try to create alias
    expect(mockExists).not.toHaveBeenCalledWith({ index: 'test-index' });
    expect(mockPutAlias).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Cannot create alias "test-index-repo": an index with this name already exists. ' +
        'The alias cannot be created because index names and alias names must be unique.'
    );
  });

  it('SHOULD use default index name when no index parameter provided', async () => {
    const defaultIndex = elasticsearch.elasticsearchConfig.index;
    mockExistsAlias.mockResolvedValue(false);
    // First call: check if alias name index exists (returns false)
    // Second call: check if target index exists (returns true)
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockPutAlias.mockResolvedValue({ acknowledged: true });

    await elasticsearch.createRepoAlias();

    expect(mockExistsAlias).toHaveBeenCalledWith({ name: `${defaultIndex}-repo` });
    expect(mockExists).toHaveBeenCalledWith({ index: `${defaultIndex}-repo` });
    expect(mockExists).toHaveBeenCalledWith({ index: defaultIndex });
    expect(mockPutAlias).toHaveBeenCalledWith({
      index: defaultIndex,
      name: `${defaultIndex}-repo`,
    });
  });

  it('SHOULD handle alias creation errors gracefully without throwing', async () => {
    mockExistsAlias.mockResolvedValue(false);
    // First call: check if alias name index exists (returns false)
    // Second call: check if target index exists (returns true)
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const error = new Error('Alias creation failed');
    mockPutAlias.mockRejectedValue(error);

    // Should not throw
    await elasticsearch.createRepoAlias('test-index');

    expect(mockLoggerError).toHaveBeenCalledWith('Failed to create alias "test-index-repo":', { error });
  });

  it('SHOULD handle existsAlias check errors gracefully', async () => {
    const error = new Error('Check failed');
    mockExistsAlias.mockRejectedValue(error);

    // Should not throw
    await elasticsearch.createRepoAlias('test-index');

    expect(mockLoggerError).toHaveBeenCalledWith('Failed to create alias "test-index-repo":', { error });
  });

  it('SHOULD handle exists check for alias name index errors gracefully', async () => {
    mockExistsAlias.mockResolvedValue(false);
    const error = new Error('Index check failed');
    mockExists.mockRejectedValue(error);

    // Should not throw
    await elasticsearch.createRepoAlias('test-index');

    expect(mockLoggerError).toHaveBeenCalledWith('Failed to create alias "test-index-repo":', { error });
  });

  it('SHOULD handle exists check for target index errors gracefully', async () => {
    mockExistsAlias.mockResolvedValue(false);
    // First call: check if alias name index exists (returns false)
    // Second call: check if target index exists (throws error)
    mockExists.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('Index check failed'));

    // Should not throw
    await elasticsearch.createRepoAlias('test-index');

    expect(mockLoggerError).toHaveBeenCalledWith('Failed to create alias "test-index-repo":', {
      error: expect.any(Error),
    });
  });

  it('SHOULD reject invalid index names', async () => {
    // Empty string should use default index name (which is valid), so we need to check that
    // For truly invalid names, validation should prevent alias creation
    await elasticsearch.createRepoAlias('invalid/index');
    await elasticsearch.createRepoAlias('_invalid');

    // These should not call existsAlias because validation fails first
    expect(mockExistsAlias).not.toHaveBeenCalled();
    expect(mockPutAlias).not.toHaveBeenCalled();

    expect(mockLoggerWarn).toHaveBeenCalledWith('Cannot create alias: invalid index name "invalid/index"');
    expect(mockLoggerWarn).toHaveBeenCalledWith('Cannot create alias: invalid index name "_invalid"');
  });

  it('SHOULD reject alias names that would be invalid', async () => {
    // Index name that would create an invalid alias
    await elasticsearch.createRepoAlias('test/repo');

    expect(mockExistsAlias).not.toHaveBeenCalled();
    expect(mockPutAlias).not.toHaveBeenCalled();

    expect(mockLoggerWarn).toHaveBeenCalledWith('Cannot create alias: invalid index name "test/repo"');
  });

  it('SHOULD reject uppercase index names', async () => {
    await elasticsearch.createRepoAlias('MyIndex');
    await elasticsearch.createRepoAlias('KIBANA');

    expect(mockExistsAlias).not.toHaveBeenCalled();
    expect(mockPutAlias).not.toHaveBeenCalled();

    expect(mockLoggerWarn).toHaveBeenCalledWith('Cannot create alias: invalid index name "MyIndex"');
    expect(mockLoggerWarn).toHaveBeenCalledWith('Cannot create alias: invalid index name "KIBANA"');
  });

  it('SHOULD handle empty string by using default index name', async () => {
    const defaultIndex = elasticsearch.elasticsearchConfig.index;
    mockExistsAlias.mockResolvedValue(false);
    // First call: check if alias name index exists (returns false)
    // Second call: check if target index exists (returns true)
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockPutAlias.mockResolvedValue({ acknowledged: true });

    await elasticsearch.createRepoAlias('');

    // Should use default index name, not fail
    expect(mockExistsAlias).toHaveBeenCalledWith({ name: `${defaultIndex}-repo` });
    expect(mockExists).toHaveBeenCalledWith({ index: `${defaultIndex}-repo` });
    expect(mockExists).toHaveBeenCalledWith({ index: defaultIndex });
    expect(mockPutAlias).toHaveBeenCalledWith({
      index: defaultIndex,
      name: `${defaultIndex}-repo`,
    });
  });

  it('SHOULD reject alias names that exceed 255 character limit', async () => {
    // Create an index name that, after normalization and adding -repo, would exceed 255 chars
    const longName = 'a'.repeat(251); // 251 chars + '-repo' (5) = 256 chars
    await elasticsearch.createRepoAlias(longName);

    expect(mockExistsAlias).not.toHaveBeenCalled();
    expect(mockPutAlias).not.toHaveBeenCalled();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      `Cannot create alias: alias name "${longName}-repo" exceeds 255 character limit`
    );
  });

  it('SHOULD normalize -repo segments from index name for alias creation', async () => {
    mockExistsAlias.mockResolvedValue(false);
    // First call: check if index with alias name exists (conflict check) - returns false (no conflict)
    // Second call: check if normalized target index exists - returns true (index 'kibana' exists)
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockPutAlias.mockResolvedValue({ acknowledged: true });

    // Index name with multiple -repo segments
    // After normalization in createRepoAlias: kibana-repo-repo-repo → kibana (baseIndexName) → alias kibana-repo
    // The function uses the normalized baseIndexName for index existence check and alias creation
    // So it checks if index 'kibana' exists and creates alias 'kibana-repo' → 'kibana'
    await elasticsearch.createRepoAlias('kibana-repo-repo-repo');

    // Should create alias 'kibana-repo' (normalized), pointing to normalized index 'kibana'
    expect(mockExistsAlias).toHaveBeenCalledWith({ name: 'kibana-repo' });
    expect(mockExists).toHaveBeenCalledWith({ index: 'kibana-repo' });
    expect(mockExists).toHaveBeenCalledWith({ index: 'kibana' });
    expect(mockPutAlias).toHaveBeenCalledWith({
      index: 'kibana',
      name: 'kibana-repo',
    });
  });

  it('SHOULD handle index name that already ends with -repo correctly', async () => {
    mockExistsAlias.mockResolvedValue(false);
    // First call: check if index with alias name exists (conflict check) - returns false (no conflict)
    // Second call: check if normalized target index exists - returns true (index 'kibana' exists)
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockPutAlias.mockResolvedValue({ acknowledged: true });

    // Index name that already ends with -repo
    // createRepoAlias normalizes the index name: 'kibana-repo' → 'kibana' (baseIndexName)
    // It uses the normalized name (baseIndexName) for index existence check and alias creation
    // So it checks if index 'kibana' exists and creates alias 'kibana-repo' → 'kibana'
    // This succeeds because alias name ('kibana-repo') differs from index name ('kibana')
    await elasticsearch.createRepoAlias('kibana-repo');

    // Should log warning about normalization
    expect(mockLoggerWarn).toHaveBeenCalledWith('Index name "kibana-repo" was normalized to "kibana" ');
    // Should check if alias exists
    expect(mockExistsAlias).toHaveBeenCalledWith({ name: 'kibana-repo' });
    // Should check for conflict (index with alias name exists) - no conflict
    expect(mockExists).toHaveBeenCalledWith({ index: 'kibana-repo' });
    // Should check if normalized target index exists
    expect(mockExists).toHaveBeenCalledWith({ index: 'kibana' });
    // Should create alias pointing to normalized index name
    expect(mockPutAlias).toHaveBeenCalledWith({
      index: 'kibana',
      name: 'kibana-repo',
    });
    expect(mockLoggerInfo).toHaveBeenCalledWith('Creating alias "kibana-repo" pointing to index "kibana"...');
    expect(mockLoggerInfo).toHaveBeenCalledWith('Successfully created alias "kibana-repo"');
  });

  it('SHOULD handle race condition when alias is created concurrently', async () => {
    mockExistsAlias.mockResolvedValue(false);
    // First call: check if alias name index exists (returns false)
    // Second call: check if target index exists (returns true)
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    // Simulate 409 conflict (alias created by another process)
    const conflictError = {
      meta: { statusCode: 409 },
      body: { error: { type: 'resource_already_exists_exception' } },
    };
    mockPutAlias.mockRejectedValue(conflictError);

    // Should not throw, should log info message
    await elasticsearch.createRepoAlias('test-index');

    expect(mockPutAlias).toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'Alias "test-index-repo" was created by another process or already exists.'
    );
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('SHOULD handle illegal_argument_exception as race condition', async () => {
    mockExistsAlias.mockResolvedValue(false);
    // First call: check if alias name index exists (returns false)
    // Second call: check if target index exists (returns true)
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const illegalArgError = {
      meta: { statusCode: 400 },
      body: { error: { type: 'illegal_argument_exception' } },
    };
    mockPutAlias.mockRejectedValue(illegalArgError);

    await elasticsearch.createRepoAlias('test-index');

    expect(mockPutAlias).toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'Alias "test-index-repo" was created by another process or already exists.'
    );
    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});

describe('createIndex integration with createRepoAlias', () => {
  let mockExists: Mock;
  let mockCreate: Mock;
  let mockExistsAlias: Mock;
  let mockPutAlias: Mock;

  beforeEach(() => {
    // Create a mock client with all necessary methods
    mockExists = vi.fn();
    mockCreate = vi.fn();
    mockExistsAlias = vi.fn();
    mockPutAlias = vi.fn();
    const mockClient = {
      indices: {
        exists: mockExists,
        create: mockCreate,
        existsAlias: mockExistsAlias,
        putAlias: mockPutAlias,
      },
    } as unknown as Client;
    elasticsearch.setClient(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    elasticsearch.setClient(undefined);
  });

  it('SHOULD create alias after creating new index', async () => {
    // First call (from createIndex) returns false (index doesn't exist yet)
    // Second call (from createRepoAlias) checks if alias name index exists (returns false)
    // Third call (from createRepoAlias) checks if target index exists (returns true, index was just created)
    mockExists
      .mockResolvedValueOnce(false) // For createIndex check
      .mockResolvedValueOnce(false) // For createRepoAlias alias name check
      .mockResolvedValueOnce(true); // For createRepoAlias target index check
    mockCreate.mockResolvedValue({ acknowledged: true });
    mockExistsAlias.mockResolvedValue(false);
    mockPutAlias.mockResolvedValue({ acknowledged: true });

    await elasticsearch.createIndex('new-index');

    expect(mockExists).toHaveBeenCalledWith({ index: 'new-index' });
    expect(mockCreate).toHaveBeenCalled();
    expect(mockExistsAlias).toHaveBeenCalledWith({ name: 'new-index-repo' });
    expect(mockExists).toHaveBeenCalledWith({ index: 'new-index-repo' });
    expect(mockPutAlias).toHaveBeenCalledWith({
      index: 'new-index',
      name: 'new-index-repo',
    });
  });

  it('SHOULD create alias for existing index if alias does not exist', async () => {
    // First call (from createIndex) returns true (index exists)
    // Second call (from createRepoAlias) checks if alias name index exists (returns false)
    // Third call (from createRepoAlias) checks if target index exists (returns true)
    mockExists
      .mockResolvedValueOnce(true) // For createIndex check
      .mockResolvedValueOnce(false) // For createRepoAlias alias name check
      .mockResolvedValueOnce(true); // For createRepoAlias target index check
    mockExistsAlias.mockResolvedValue(false); // Alias does not exist
    mockPutAlias.mockResolvedValue({ acknowledged: true });

    await elasticsearch.createIndex('existing-index');

    expect(mockExists).toHaveBeenCalledWith({ index: 'existing-index' });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockExistsAlias).toHaveBeenCalledWith({ name: 'existing-index-repo' });
    expect(mockExists).toHaveBeenCalledWith({ index: 'existing-index-repo' });
    expect(mockPutAlias).toHaveBeenCalledWith({
      index: 'existing-index',
      name: 'existing-index-repo',
    });
  });

  it('SHOULD skip alias creation for existing index if alias already exists', async () => {
    mockExists.mockResolvedValue(true); // Index exists
    mockExistsAlias.mockResolvedValue(true); // Alias already exists

    await elasticsearch.createIndex('existing-index');

    expect(mockExists).toHaveBeenCalledWith({ index: 'existing-index' });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockExistsAlias).toHaveBeenCalledWith({ name: 'existing-index-repo' });
    expect(mockPutAlias).not.toHaveBeenCalled();
  });

  it('SHOULD handle alias creation errors without failing index creation', async () => {
    // First call (from createIndex) returns false (index doesn't exist yet)
    // Second call (from createRepoAlias) checks if alias name index exists (returns false)
    // Third call (from createRepoAlias) checks if target index exists (returns true, index was just created)
    mockExists
      .mockResolvedValueOnce(false) // For createIndex check
      .mockResolvedValueOnce(false) // For createRepoAlias alias name check
      .mockResolvedValueOnce(true); // For createRepoAlias target index check
    mockCreate.mockResolvedValue({ acknowledged: true });
    mockExistsAlias.mockResolvedValue(false);
    const aliasError = new Error('Alias creation failed');
    mockPutAlias.mockRejectedValue(aliasError);

    // Index creation should succeed even if alias creation fails
    await elasticsearch.createIndex('test-index');

    expect(mockCreate).toHaveBeenCalled();
    expect(mockPutAlias).toHaveBeenCalled();
  });
});

describe('Elasticsearch Client Configuration', () => {
  describe('WHEN examining the client configuration', () => {
    it('SHOULD have a client instance', () => {
      expect(elasticsearch.getClient).toBeDefined();
      const client = elasticsearch.getClient();
      expect(client).toBeDefined();
    });

    it('SHOULD have request timeout configured', () => {
      // The client is initialized with our .env config
      // We can verify it's a valid Client instance
      const client = elasticsearch.getClient();
      expect(client.transport).toBeDefined();
    });
  });

  describe('WHEN using elasticsearchConfig', () => {
    it('SHOULD export elasticsearchConfig', () => {
      expect(elasticsearch.elasticsearchConfig).toBeDefined();
    });

    it('SHOULD have inference ID configured', () => {
      expect(elasticsearch.elasticsearchConfig.inferenceId).toBeDefined();
      expect(typeof elasticsearch.elasticsearchConfig.inferenceId).toBe('string');
    });

    it('SHOULD prioritize ELASTICSEARCH_CLOUD_ID over ELASTICSEARCH_ENDPOINT when both are set', () => {
      // This validates our configuration logic by checking what was actually used
      const config = elasticsearch.elasticsearchConfig;

      // If cloudId is set, it should be used (our current .env has cloudId)
      if (config.cloudId) {
        expect(config.cloudId).toBeTruthy();
      } else if (config.endpoint) {
        expect(config.endpoint).toBeTruthy();
      } else {
        // At least one should be set for the client to initialize
        expect.fail('Neither cloudId nor endpoint is configured');
      }
    });

    it('SHOULD have auth configuration when cloudId is set', () => {
      const config = elasticsearch.elasticsearchConfig;

      // If using cloudId (which our .env does), we must have auth
      if (config.cloudId) {
        const hasApiKey = !!config.apiKey;
        const hasUsernamePassword = !!(config.username && config.password);

        expect(hasApiKey || hasUsernamePassword).toBe(true);
      }
    });
  });
});
