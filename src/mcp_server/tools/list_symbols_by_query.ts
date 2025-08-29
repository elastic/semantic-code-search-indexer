import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import { aggregateBySymbols } from '../../utils/elasticsearch';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';

export const listSymbolsByQuerySchema = z.object({
  kql: z.string().describe('The KQL query string.'),
});

export type ListSymbolsByQueryParams = z.infer<typeof listSymbolsByQuerySchema>;

export async function listSymbolsByQuery(params: ListSymbolsByQueryParams): Promise<CallToolResult> {
  const { kql } = params;

  const ast = fromKueryExpression(kql);
  const dsl = toElasticsearchQuery(ast);

  const results = await aggregateBySymbols(dsl);

  return {
    content: [{ type: 'text', text: JSON.stringify(results) }]
  };
}
