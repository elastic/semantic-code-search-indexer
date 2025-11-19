import { Command, Option } from 'commander';
import { searchCodeChunks } from '../utils/elasticsearch';

/**
 * Search command - performs semantic search on indexed code
 */
export async function search(query: string, options: { index?: string; limit?: string }) {
  console.log(`Searching for: "${query}"`);

  const limit = options.limit ? parseInt(options.limit, 10) : 10;
  const results = await searchCodeChunks(query, options.index);

  console.log(`\nSearch results (showing top ${Math.min(limit, results.length)} of ${results.length}):`);

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  results.slice(0, limit).forEach((result, index) => {
    console.log('\n' + '='.repeat(80));
    console.log(`Result #${index + 1} (Score: ${result.score.toFixed(2)})`);
    console.log('='.repeat(80));
    console.log(`File: ${result.filePath}`);
    console.log(`Lines: ${result.startLine}-${result.endLine}`);
    if (result.kind) {
      console.log(`Kind: ${result.kind}`);
    }
    console.log('\nContent:');
    console.log('-'.repeat(80));
    console.log(result.content);
  });

  console.log('\n' + '='.repeat(80));
  console.log(`Total results: ${results.length}`);
}

export const searchCommand = new Command('search')
  .description('Search indexed code using semantic search')
  .argument('<query>', 'Search query (natural language)')
  .addOption(new Option('--index <index>', 'Elasticsearch index to search (default: from config)'))
  .addOption(new Option('--limit <number>', 'Maximum number of results to display').default('10'))
  .action(async (query, options) => {
    try {
      await search(query, options);
    } catch (error) {
      console.error('Search failed:', error);
      process.exit(1);
    }
  });
