import { searchCodeChunks, aggregateBySymbols } from '../utils/elasticsearch';
import { fromKueryExpression, toElasticsearchQuery } from '../../libs/es-query';

/**
 * The main function for the `search` command.
 *
 * This function is responsible for orchestrating the search process. It can
 * perform either a semantic search or a symbol aggregation, depending on the
 * value of the `aggregateSymbols` flag.
 *
 * @param query The search query.
 * @param aggregateSymbols Whether to perform a symbol aggregation instead of a
 * semantic search.
 */
export async function search(query: string, aggregateSymbols: boolean) {
  if (aggregateSymbols) {
    console.log(`Aggregating symbols for query: "${query}"`);
    const ast = fromKueryExpression(query);
    const dsl = toElasticsearchQuery(ast);
    const results = await aggregateBySymbols(dsl);

    console.log('Aggregation results:');
    if (Object.keys(results).length === 0) {
      console.log('No results found.');
      return;
    }
    for (const filePath in results) {
      console.log('---');
      console.log(`File: ${filePath}`);
      console.log('Symbols:');
      results[filePath].forEach(symbol => {
        console.log(`  - ${symbol.name} (${symbol.kind}) [line ${symbol.line}]`);
      });
    }
    return;
  }

  console.log(`Searching for: "${query}"`);
  const results = await searchCodeChunks(query);

  console.log('Search results:');
  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  results.forEach(result => {
    console.log('---');
    console.log(`File: ${result.filePath}`);
    console.log(`Lines: ${result.startLine} - ${result.endLine}`);
    console.log(`Score: ${result.score}`);
    console.log('Content:');
    console.log(result.content);
  });
}
