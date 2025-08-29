import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import { searchCodeChunks } from '../../utils/elasticsearch';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';

import { client, elasticsearchConfig } from '../../utils/elasticsearch';
export const semanticCodeSearchSchema = z.object({
  query: z.string().optional().describe('The semantic query string.'),
  kql: z.string().optional().describe('The KQL query string.'),
  page: z.number().default(1).describe('The page number for pagination.'),
  size: z.number().default(25).describe('The number of results per page.'),
});

export type SemanticCodeSearchParams = z.infer<typeof semanticCodeSearchSchema>;

export async function semanticCodeSearch(params: SemanticCodeSearchParams): Promise<CallToolResult> {
  const { query, kql, page, size } = params;

  if (!query && !kql) {
    throw new Error('Either a query for semantic search or a kql filter is required.');
  }

  const must: QueryDslQueryContainer[] = [];

  if (query) {
    must.push({
      semantic: {
        field: 'semantic_text',
        query: query,
      },
    });
  }

  if (kql) {
    const ast = fromKueryExpression(kql);
    const dsl = toElasticsearchQuery(ast);
    must.push(dsl);
  }

  const esQuery: QueryDslQueryContainer = {
    bool: {
      must
    }
  }

  const response = await client.search({
    index: elasticsearchConfig.index,
    query: esQuery,
    from: (page - 1) * size,
    size: size,
    _source_excludes: ['code_vector', 'semantic_text'],
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(response.hits.hits.map(hit => hit._source)) }]
  };
}
