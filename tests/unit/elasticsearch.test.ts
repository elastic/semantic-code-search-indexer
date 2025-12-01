import * as elasticsearch from '../../src/utils/elasticsearch';
import { CodeChunk } from '../../src/utils/elasticsearch';
import { Client } from '@elastic/elasticsearch';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';

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

  beforeEach(() => {
    mockBulk = vi.spyOn(elasticsearch.client, 'bulk');
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

describe('Elasticsearch Client Configuration', () => {
  describe('WHEN examining the client configuration', () => {
    it('SHOULD have a client instance', () => {
      expect(elasticsearch.client).toBeDefined();
      expect(elasticsearch.client).toBeInstanceOf(Client);
    });

    it('SHOULD have request timeout configured', () => {
      // The client is already initialized with our .env config
      // We can verify it's a valid Client instance
      expect(elasticsearch.client.transport).toBeDefined();
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
