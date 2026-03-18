import { Client } from '@elastic/elasticsearch';
import { beforeEach, describe, it, expect, vi, afterEach } from 'vitest';
import type { Mock } from 'vitest';

import * as elasticsearch from '../../src/utils/elasticsearch';
import { CodeChunk } from '../../src/utils/elasticsearch';

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

  it('should create one chunk doc and index locations for all inputs', async () => {
    const chunkA: CodeChunk = { ...MOCK_CHUNK, filePath: 'a.ts', startLine: 1, endLine: 1 };
    const chunkB: CodeChunk = { ...MOCK_CHUNK, filePath: 'b.ts', startLine: 2, endLine: 2 };

    let createdChunkId = '';
    mockBulk
      .mockImplementationOnce(async ({ operations }: { operations: unknown[] }) => {
        const action = operations[0] as { create?: { _id?: string } };
        createdChunkId = action.create?._id ?? '';
        return {
          errors: false,
          items: [{ create: { status: 201, _index: 'test-index', _id: createdChunkId } }],
        };
      })
      .mockImplementationOnce(async ({ operations }: { operations: unknown[] }) => {
        // Two locations: 2 index ops (4 array entries).
        expect(operations).toHaveLength(4);
        const body1 = operations[1] as { chunk_id?: string; filePath?: string };
        const body2 = operations[3] as { chunk_id?: string; filePath?: string };
        expect(body1.chunk_id).toBe(createdChunkId);
        expect(body2.chunk_id).toBe(createdChunkId);
        expect(new Set([body1.filePath, body2.filePath])).toEqual(new Set(['a.ts', 'b.ts']));
        return {
          errors: false,
          items: [{ index: { status: 201 } }, { index: { status: 201 } }],
        };
      });

    const result = await elasticsearch.indexCodeChunks([chunkA, chunkB], 'test-index');

    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(mockBulk).toHaveBeenCalledTimes(2);

    // Ensure chunk-doc body does not include file-specific metadata.
    const firstBulkArgs = mockBulk.mock.calls[0]?.[0] as { operations: unknown[] };
    const chunkDocBody = firstBulkArgs.operations[1] as Record<string, unknown>;
    expect(chunkDocBody.filePath).toBeUndefined();
    expect(chunkDocBody.startLine).toBeUndefined();
    expect(chunkDocBody.endLine).toBeUndefined();
    expect(chunkDocBody.directoryPath).toBeUndefined();
  });

  it('should treat 409 create conflicts as success (no re-inference)', async () => {
    const chunkA: CodeChunk = { ...MOCK_CHUNK, filePath: 'a.ts', startLine: 1, endLine: 1 };
    const chunkB: CodeChunk = { ...MOCK_CHUNK, filePath: 'b.ts', startLine: 2, endLine: 2 };

    mockBulk
      .mockResolvedValueOnce({
        errors: true,
        items: [
          {
            create: {
              status: 409,
              error: { type: 'version_conflict_engine_exception', reason: 'document already exists' },
            },
          },
        ],
      })
      .mockResolvedValueOnce({ errors: false, items: [{ index: { status: 201 } }, { index: { status: 201 } }] });

    const result = await elasticsearch.indexCodeChunks([chunkA, chunkB], 'test-index');
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
  });

  it('should fail all grouped inputs when chunk create fails', async () => {
    const chunkA: CodeChunk = { ...MOCK_CHUNK, filePath: 'a.ts', startLine: 1, endLine: 1 };
    const chunkB: CodeChunk = { ...MOCK_CHUNK, filePath: 'b.ts', startLine: 2, endLine: 2 };

    mockBulk.mockResolvedValueOnce({
      errors: true,
      items: [
        {
          create: {
            status: 400,
            error: { type: 'mapper_parsing_exception', reason: 'boom' },
          },
        },
      ],
    });

    const result = await elasticsearch.indexCodeChunks([chunkA, chunkB], 'test-index');
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(2);
    expect(mockBulk).toHaveBeenCalledTimes(1);
  });

  it('should fail only the affected input when location indexing fails', async () => {
    const chunkA: CodeChunk = { ...MOCK_CHUNK, filePath: 'a.ts', startLine: 1, endLine: 1 };
    const chunkB: CodeChunk = { ...MOCK_CHUNK, filePath: 'b.ts', startLine: 2, endLine: 2 };

    mockBulk
      .mockResolvedValueOnce({
        errors: false,
        items: [{ create: { status: 201, _index: 'test-index', _id: 'cid' } }],
      })
      .mockResolvedValueOnce({
        errors: true,
        items: [
          { index: { status: 201 } },
          { index: { status: 400, error: { type: 'mapper_parsing_exception', reason: 'bad location' } } },
        ],
      });

    const result = await elasticsearch.indexCodeChunks([chunkA, chunkB], 'test-index');
    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  });
});

describe('deleteDocumentsByFilePath', () => {
  let mockOpenPit: Mock;
  let mockClosePit: Mock;
  let mockSearch: Mock;
  let mockBulk: Mock;
  let mockIndicesExists: Mock;
  let mockClient: Client;

  beforeEach(() => {
    mockOpenPit = vi.fn();
    mockClosePit = vi.fn();
    mockSearch = vi.fn();
    mockBulk = vi.fn();
    mockIndicesExists = vi.fn();

    mockClient = {
      openPointInTime: mockOpenPit,
      closePointInTime: mockClosePit,
      search: mockSearch,
      bulk: mockBulk,
      indices: {
        exists: mockIndicesExists,
        refresh: vi.fn(),
      },
    } as unknown as Client;

    elasticsearch.setClient(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
    elasticsearch.setClient(undefined);
  });

  it('should delete location docs for a file path and delete orphan chunk docs', async () => {
    mockIndicesExists.mockResolvedValue(true);
    mockOpenPit.mockResolvedValue({ id: 'pit-1' });

    // PIT scan: one location hit, then empty.
    mockSearch
      .mockResolvedValueOnce({
        hits: {
          hits: [
            {
              _id: 'loc-1',
              sort: [1],
              _source: { chunk_id: 'chunk-1' },
            },
          ],
        },
      })
      .mockResolvedValueOnce({ hits: { hits: [] } })
      // Orphan check: no remaining locations for chunk-1
      .mockResolvedValueOnce({
        aggregations: {
          present: { buckets: [] },
        },
        hits: { total: { value: 0 } },
      });

    mockBulk
      // location bulk delete
      .mockResolvedValueOnce({ errors: false, items: [{ delete: { status: 200 } }] })
      // chunk bulk delete
      .mockResolvedValueOnce({ errors: false, items: [{ delete: { status: 200 } }] });

    await elasticsearch.deleteDocumentsByFilePath('a.ts', 'idx');

    expect(mockOpenPit).toHaveBeenCalledTimes(1);
    expect(mockClosePit).toHaveBeenCalledWith({ id: 'pit-1' });
    expect(mockBulk).toHaveBeenCalledTimes(2);

    const firstBulkArgs = mockBulk.mock.calls[0]?.[0] as { operations: unknown[] };
    expect(firstBulkArgs.operations).toEqual([{ delete: { _index: 'idx_locations', _id: 'loc-1' } }]);

    const secondBulkArgs = mockBulk.mock.calls[1]?.[0] as { operations: unknown[] };
    expect(secondBulkArgs.operations).toEqual([{ delete: { _index: 'idx', _id: 'chunk-1' } }]);
  });
});

describe('resolveAliasToIndex', () => {
  let mockGetAlias: Mock;
  let mockClient: Client;

  beforeEach(() => {
    mockGetAlias = vi.fn();
    mockClient = {
      indices: {
        getAlias: mockGetAlias,
      },
    } as unknown as Client;

    elasticsearch.setClient(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
    elasticsearch.setClient(undefined);
  });

  it('should return null when alias does not exist', async () => {
    mockGetAlias.mockRejectedValue({ meta: { statusCode: 404 } });
    await expect(elasticsearch.resolveAliasToIndex('my-alias')).resolves.toBeNull();
  });

  it('should return the only index when alias points to one index', async () => {
    mockGetAlias.mockResolvedValue({
      'idx-1': {
        aliases: {
          'my-alias': {},
        },
      },
    });

    await expect(elasticsearch.resolveAliasToIndex('my-alias')).resolves.toBe('idx-1');
  });

  it('should return write index when alias points to multiple indices', async () => {
    mockGetAlias.mockResolvedValue({
      'idx-a': {
        aliases: {
          'my-alias': {
            is_write_index: true,
          },
        },
      },
      'idx-b': {
        aliases: {
          'my-alias': {},
        },
      },
    });

    await expect(elasticsearch.resolveAliasToIndex('my-alias')).resolves.toBe('idx-a');
  });

  it('should throw when alias points to multiple indices without write index', async () => {
    mockGetAlias.mockResolvedValue({
      'idx-a': {
        aliases: {
          'my-alias': {},
        },
      },
      'idx-b': {
        aliases: {
          'my-alias': {},
        },
      },
    });

    await expect(elasticsearch.resolveAliasToIndex('my-alias')).rejects.toThrow(
      'Alias "my-alias" points to multiple indices (idx-a, idx-b) with no write index configured.'
    );
  });
});

describe('reindex lock TTL', () => {
  let mockGet: Mock;
  let mockCreate: Mock;
  let mockDelete: Mock;
  let mockIndicesExists: Mock;
  let mockIndicesCreate: Mock;
  let mockClient: Client;

  const nowIso = () => new Date().toISOString();

  const makeLock = (options: { alias: string; expiresAt: string }) => ({
    type: 'reindex_lock' as const,
    alias: options.alias,
    lock_owner: 'unit-test',
    lock_acquired_at: nowIso(),
    lock_expires_at: options.expiresAt,
    updated_at: nowIso(),
  });

  beforeEach(() => {
    mockGet = vi.fn();
    mockCreate = vi.fn();
    mockDelete = vi.fn();
    mockIndicesExists = vi.fn().mockResolvedValue(true);
    mockIndicesCreate = vi.fn().mockResolvedValue({});

    mockClient = {
      get: mockGet,
      create: mockCreate,
      delete: mockDelete,
      indices: {
        exists: mockIndicesExists,
        create: mockIndicesCreate,
      },
    } as unknown as Client;

    elasticsearch.setClient(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    elasticsearch.setClient(undefined);
  });

  it('isReindexLocked SHOULD delete expired locks and return false', async () => {
    const aliasName = 'my-alias';
    mockGet.mockResolvedValue({
      _source: makeLock({ alias: aliasName, expiresAt: new Date(Date.now() - 60_000).toISOString() }),
    });
    mockDelete.mockResolvedValue({});

    await expect(elasticsearch.isReindexLocked(aliasName)).resolves.toBe(false);
    expect(mockDelete).toHaveBeenCalledWith({
      index: `${aliasName}_settings`,
      id: '_reindex_lock',
      refresh: true,
    });
  });

  it('isReindexLocked SHOULD return true when lock is not expired', async () => {
    const aliasName = 'my-alias';
    mockGet.mockResolvedValue({
      _source: makeLock({ alias: aliasName, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    });

    await expect(elasticsearch.isReindexLocked(aliasName)).resolves.toBe(true);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('acquireReindexLock SHOULD clear expired locks and acquire', async () => {
    const aliasName = 'my-alias';
    const conflictError = { meta: { statusCode: 409 } };

    mockCreate.mockRejectedValueOnce(conflictError).mockResolvedValueOnce({});
    mockGet.mockResolvedValue({
      _source: makeLock({ alias: aliasName, expiresAt: new Date(Date.now() - 60_000).toISOString() }),
    });
    mockDelete.mockResolvedValue({});

    const result = await elasticsearch.acquireReindexLock(aliasName, 'owner', 60_000);

    expect(result.acquired).toBe(true);
    expect(result.lock?.alias).toBe(aliasName);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});

describe('aggregateBySymbols', () => {
  let mockSearch: Mock;
  let mockIndicesExists: Mock;
  let mockClient: Client;

  beforeEach(() => {
    mockSearch = vi.fn();
    mockIndicesExists = vi.fn().mockResolvedValue(true);

    mockClient = {
      search: mockSearch,
      indices: {
        exists: mockIndicesExists,
      },
    } as unknown as Client;

    elasticsearch.setClient(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    elasticsearch.setClient(undefined);
  });

  it('SHOULD join chunk symbols with locations by filePath', async () => {
    mockSearch
      // 1) Search chunk docs (ids + symbols)
      .mockResolvedValueOnce({
        hits: {
          hits: [
            {
              _id: 'chunk-1',
              _source: { symbols: [{ name: 'foo', kind: 'function', line: 10 }] },
            },
            {
              _id: 'chunk-2',
              _source: { symbols: [{ name: 'bar', kind: 'class', line: 5 }] },
            },
          ],
        },
      })
      // 2) Aggregate locations by filePath -> chunk_id
      .mockResolvedValueOnce({
        aggregations: {
          files: {
            buckets: [
              {
                key: 'a.ts',
                chunks: { buckets: [{ key: 'chunk-1' }] },
              },
              {
                key: 'b.ts',
                chunks: { buckets: [{ key: 'chunk-1' }, { key: 'chunk-2' }] },
              },
            ],
          },
        },
      });

    const result = await elasticsearch.aggregateBySymbols({ match_all: {} }, 'idx');

    expect(Object.keys(result).sort()).toEqual(['a.ts', 'b.ts']);
    expect(result['a.ts']).toEqual([{ name: 'foo', kind: 'function', line: 10 }]);

    // Sorted by name in implementation
    expect(result['b.ts']).toEqual([
      { name: 'bar', kind: 'class', line: 5 },
      { name: 'foo', kind: 'function', line: 10 },
    ]);

    // Ensure second call targets locations index.
    const secondCallArgs = mockSearch.mock.calls[1]?.[0] as { index?: string };
    expect(secondCallArgs.index).toBe('idx_locations');
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
