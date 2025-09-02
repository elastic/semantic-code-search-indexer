import { symbolAnalysis } from '../../src/mcp_server/tools/symbol_analysis';
import { client } from '../../src/utils/elasticsearch';

jest.mock('../../src/utils/elasticsearch', () => ({
  ...jest.requireActual('../../src/utils/elasticsearch'),
  client: {
    search: jest.fn(),
  },
}));


describe('symbol_analysis', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should construct the correct Elasticsearch query and format the report', async () => {
    (client.search as jest.Mock).mockResolvedValue({
      aggregations: {
        files: {
          buckets: [
            {
              key: 'src/index.ts',
              kinds: {
                buckets: [
                  {
                    key: 'function_declaration',
                    startLines: {
                      buckets: [{ key: 10 }],
                    },
                  },
                  {
                    key: 'import_statement',
                    startLines: {
                      buckets: [{ key: 1 }],
                    },
                  },
                ],
              },
              languages: {
                buckets: [{ key: 'typescript' }],
              },
            },
            {
              key: 'README.md',
              kinds: {
                buckets: [],
              },
              languages: {
                buckets: [{ key: 'markdown' }],
              },
            },
          ],
        },
      },
    });

    const result = await symbolAnalysis({ symbolName: 'mySymbol' });
    const report = JSON.parse(result.content[0].text as string);

    expect(client.search).toHaveBeenCalledWith({
      index: 'semantic-code-search',
      query: {
        bool: {
          minimum_should_match: 1,
          should: [
            {
              match_phrase: {
                content: 'mySymbol',
              },
            },
          ],
        },
      },
      aggs: {
        files: {
          terms: {
            field: 'filePath',
            size: 1000,
          },
          aggs: {
            kinds: {
              terms: {
                field: 'kind',
                size: 100,
              },
              aggs: {
                startLines: {
                  terms: {
                    field: 'startLine',
                    size: 100,
                  },
                },
              },
            },
            languages: {
              terms: {
                field: 'language',
                size: 10,
              },
            },
          },
        },
      },
      size: 0,
    });

    expect(report.primaryDefinitions).toHaveLength(1);
    expect(report.primaryDefinitions[0].filePath).toBe('src/index.ts');
    expect(report.primaryDefinitions[0].kinds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'function_declaration',
          startLines: [10],
        }),
      ])
    );
    expect(report.importReferences).toHaveLength(1);
    expect(report.importReferences[0].filePath).toBe('src/index.ts');
    expect(report.documentation).toHaveLength(1);
    expect(report.documentation[0].filePath).toBe('README.md');
  });
});
