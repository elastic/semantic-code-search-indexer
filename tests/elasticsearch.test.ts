import * as elasticsearch from '../src/utils/elasticsearch';
import { CodeChunk } from '../src/utils/elasticsearch';

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
  let mockBulk: jest.SpyInstance;

  beforeEach(() => {
    // Spy on the client.bulk method
    mockBulk = jest.spyOn(elasticsearch.client, 'bulk');
  });

  afterEach(() => {
    mockBulk.mockRestore();
  });

  it('should not throw when bulk indexing succeeds', async () => {
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

    await expect(elasticsearch.indexCodeChunks(chunks)).resolves.not.toThrow();
    expect(mockBulk).toHaveBeenCalledTimes(1);
  });

  it('should throw error when bulk indexing fails', async () => {
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

    await expect(elasticsearch.indexCodeChunks(chunks)).rejects.toThrow(
      /Bulk indexing failed: 1 of 1 documents had errors/
    );
    expect(mockBulk).toHaveBeenCalledTimes(1);
  });

  it('should include first error details in error message', async () => {
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

    try {
      await elasticsearch.indexCodeChunks(chunks);
      fail('Expected indexCodeChunks to throw an error');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).toContain('Bulk indexing failed: 1 of 1 documents had errors');
        expect(error.message).toContain('index_not_found_exception');
        expect(error.message).toContain('no such index [missing-index]');
      }
    }
  });

  it('should handle multiple errors and report count correctly', async () => {
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

    try {
      await elasticsearch.indexCodeChunks(chunks);
      fail('Expected indexCodeChunks to throw an error');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).toContain('Bulk indexing failed: 2 of 3 documents had errors');
        expect(error.message).toContain('mapper_parsing_exception');
      }
    }
  });

  it('should return early when chunks array is empty', async () => {
    await elasticsearch.indexCodeChunks([]);
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

    await expect(elasticsearch.indexCodeChunks(chunks)).rejects.toThrow(
      /Bulk indexing failed: 1 of 1 documents had errors/
    );
  });
});
