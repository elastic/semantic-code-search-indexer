import { semanticCodeSearch } from '../../src/mcp_server/tools/semantic_code_search';
import { client } from '../../src/utils/elasticsearch';

jest.mock('../../src/utils/elasticsearch', () => ({
  client: {
    search: jest.fn(),
  },
  elasticsearchConfig: {
    index: 'test-index',
  },
}));

describe('semantic_code_search', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should throw an error if no query or kql is provided', async () => {
    await expect(semanticCodeSearch({ page: 1, size: 10 })).rejects.toThrow(
      'Either a query for semantic search or a kql filter is required.'
    );
  });

  it('should construct the correct Elasticsearch query with both query and kql', async () => {
    (client.search as jest.Mock).mockResolvedValue({
      hits: {
        hits: [],
      },
    });

    await semanticCodeSearch({
      query: 'test query',
      kql: 'language: typescript',
      page: 2,
      size: 50,
    });

    expect(client.search).toHaveBeenCalledWith({
      index: 'test-index',
      query: {
        bool: {
          must: [
            {
              semantic: {
                field: 'semantic_text',
                query: 'test query',
              },
            },
            {
              bool: {
                minimum_should_match: 1,
                should: [
                  {
                    match: {
                      language: 'typescript',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      from: 50,
      size: 50,
      _source_excludes: ['code_vector', 'semantic_text'],
    });
  });
});