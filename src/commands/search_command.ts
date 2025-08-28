import { searchCodeChunks, aggregateBySymbols } from '../utils/elasticsearch';

export async function search(query: string, aggregateSymbols: boolean) {
  if (aggregateSymbols) {
    console.log(`Aggregating symbols for query: \"${query}\"`);
    const results = await aggregateBySymbols(query);
    console.log('Aggregation results:');
    if (Object.keys(results).length === 0) {
      console.log('No results found.');
      return;
    }
    for (const filePath in results) {
      console.log('---');
      console.log(`File: ${filePath}`);
      console.log(`Symbols: ${results[filePath].join(', ')}`);
    }
    return;
  }

  console.log(`Searching for: \"${query}\"`);
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
