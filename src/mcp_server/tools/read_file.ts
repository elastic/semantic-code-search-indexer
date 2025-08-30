import { z } from 'zod';
import { client, elasticsearchConfig } from '../../utils/elasticsearch';
import { Sort } from '@elastic/elasticsearch/lib/api/types';

/**
 * The Zod schema for the `readFile` tool.
 * @property {string[]} filePaths - An array of one or more absolute file paths to read.
 */
export const readFileSchema = z.object({
  filePaths: z.array(z.string()).nonempty(),
});

/**
 * @interface CodeChunkHit
 * @description Defines the structure of a search hit from Elasticsearch, including the source document and sort values.
 * @property {object} _source - The source document of the code chunk.
 * @property {string} _source.filePath - The path to the file.
 * @property {string} _source.content - The content of the code chunk.
 * @property {number} _source.startLine - The starting line number of the chunk.
 * @property {number} _source.endLine - The ending line number of the chunk.
 * @property {(string | number)[]} sort - The sort values for search_after pagination.
 */
interface CodeChunkHit {
  _source: {
    filePath: string;
    content: string;
    startLine: number;
    endLine: number;
  };
  sort: (string | number)[];
}

/**
 * Reads the content of a file from the index, providing a reconstructed view
 * based on the most important indexed chunks. This function uses Elasticsearch's
 * `search_after` feature to paginate through all relevant chunks for the given file paths.
 *
 * @param {object} params - The parameters for the function.
 * @param {string[]} params.filePaths - An array of one or more absolute file paths to read.
 * @returns {Promise<object>} A promise that resolves to an object containing the reconstructed file content,
 * formatted for the MCP server.
 */
export async function readFile({ filePaths }: z.infer<typeof readFileSchema>) {
  const allHits: CodeChunkHit[] = [];
  let searchAfter: (string | number)[] | undefined = undefined;

  // The sort order is crucial for pagination and reconstruction
  const sort: Sort = [
    { filePath: 'asc' },
    { startLine: 'asc' },
    { updated_at: 'desc' },
    { chunk_hash: 'asc' }, // Tie-breaker for consistent sorting
  ];

  const { index } = elasticsearchConfig;

  while (true) {
    const response = await client.search({
      index,
      size: 1000, // Fetch in batches of 1000
      query: {
        bool: {
          should: filePaths.map(filePath => ({
            match: { filePath },
          })),
          minimum_should_match: 1,
        },
      },
      sort,
      search_after: searchAfter,
    });

    const hits = response.hits.hits as CodeChunkHit[];
    if (hits.length === 0) {
      break; // No more results, exit the loop
    }

    allHits.push(...hits);
    searchAfter = hits[hits.length - 1].sort; // Get the sort values of the last document
  }

  // Group chunks by filePath
  const chunksByFile = new Map<string, CodeChunkHit[]>();
  for (const hit of allHits) {
    const filePath = hit._source.filePath;
    if (!chunksByFile.has(filePath)) {
      chunksByFile.set(filePath, []);
    }
    chunksByFile.get(filePath)!.push(hit);
  }

  // Reconstruct each file
  const reconstructedFiles: { [filePath: string]: string } = {};
  for (const filePath of filePaths) {
    const chunks = chunksByFile.get(filePath);

    if (!chunks || chunks.length === 0) {
      reconstructedFiles[filePath] = '// File not found in index';
      continue;
    }

    let reconstructedContent = '';
    let lastLine = 0;

    for (const chunk of chunks) {
      if (chunk._source.startLine > lastLine + 1) {
        reconstructedContent += `
// ... [irrelevant sections omitted] ...

`;
      }
      reconstructedContent += chunk._source.content;
      lastLine = chunk._source.endLine;
    }
    reconstructedFiles[filePath] = reconstructedContent;
  }

  const content = Object.entries(reconstructedFiles).map(([filePath, fileContent]) => ({
    type: 'text' as const,
    text: `File: ${filePath}\n\n${fileContent}`,
  }));

  return {
    content,
  };
}