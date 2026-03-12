import { Command, Option } from 'commander';
import { getLocationsForChunkIds, indexHasSemanticTextField, searchCodeChunks } from '../utils/elasticsearch';

/**
 * Search command - performs semantic search on indexed code
 */
export async function search(query: string, options: { index: string; limit?: string }) {
  console.log(`Searching for: "${query}"`);

  const indexName = options.index;

  const limit = options.limit ? parseInt(options.limit, 10) : 10;

  const semanticTextEnabled = await indexHasSemanticTextField(indexName);
  if (!semanticTextEnabled) {
    throw new Error(
      `Index "${indexName}" does not have a "semantic_text" mapping, so semantic search cannot run. ` +
        'This usually happens when the index was created with semantic text disabled. ' +
        'Recreate the index with semantic text enabled and reindex your code, or use a non-semantic search command.'
    );
  }

  const results = await searchCodeChunks(query, indexName);

  console.log(`\nSearch results (showing top ${Math.min(limit, results.length)} of ${results.length}):`);

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  const visible = results.slice(0, limit);
  const locationsByChunkId = await getLocationsForChunkIds(
    visible.map((r) => r.id),
    { index: indexName, perChunkLimit: 5 }
  );

  visible.forEach((result, index) => {
    console.log('\n' + '='.repeat(80));
    console.log(`Result #${index + 1} (Score: ${result.score.toFixed(2)})`);
    console.log('='.repeat(80));
    const locations = locationsByChunkId[result.id] ?? [];
    if (locations.length > 0) {
      console.log(`Locations (sample): ${locations.length}`);
      locations.forEach((p) => {
        console.log(`- ${p.filePath}:${p.startLine}-${p.endLine}`);
      });
    }
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
  .addOption(new Option('--index <index>', 'Elasticsearch index to search (required)').makeOptionMandatory())
  .addOption(new Option('--limit <number>', 'Maximum number of results to display').default('10'))
  .action(async (query, options) => {
    try {
      await search(query, options);
    } catch (error) {
      console.error('Search failed:', error);
      process.exit(1);
    }
  });
