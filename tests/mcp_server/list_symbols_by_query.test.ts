import { listSymbolsByQuery } from '../../src/mcp_server/tools/list_symbols_by_query';
import { aggregateBySymbols } from '../../src/utils/elasticsearch';

jest.mock('../../src/utils/elasticsearch', () => ({
  ...jest.requireActual('../../src/utils/elasticsearch'),
  aggregateBySymbols: jest.fn(),
}));

describe('list_symbols_by_query', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call aggregateBySymbols with the correct DSL query', async () => {
    (aggregateBySymbols as jest.Mock).mockResolvedValue({});

    await listSymbolsByQuery({ kql: 'language: typescript' });

    expect(aggregateBySymbols).toHaveBeenCalledWith({
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
    });
  });
});