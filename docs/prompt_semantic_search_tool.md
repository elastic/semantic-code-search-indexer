Hello! Your task is to create a "Semantic Search" tool for the Kibana MCP server.

This tool will allow users to search the Kibana codebase using natural language queries. It will be powered by an Elasticsearch index and a sentence-transformer model for generating vector embeddings. The tool will be registered with the server using an existing `addTool` function.

Note: this prompt predates the indexer’s move to Elasticsearch `semantic_text` + `semantic` queries. In current deployments, semantic search is performed by querying the `semantic_text` field, and per-file reconstruction/filtering uses `<index>_locations` (not fields on the chunk document).

**Goal:** Create a tool that takes a natural language query as input, converts it to a vector embedding, and searches an Elasticsearch index to find semantically similar code chunks.

---

### File 1: `src/tools/semantic_search/embedding.ts`

This file contains the logic for loading a local sentence-transformer model and generating vector embeddings for a given text.

```typescript
import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';

let extractor: FeatureExtractionPipeline;

async function initializeEmbeddingModel() {
  if (!extractor) {
    // This assumes the model has been downloaded locally to the specified path.
    // The model name is 'jinaai/jina-embeddings-v2-base-code'.
    extractor = await pipeline('feature-extraction', 'jinaai/jina-embeddings-v2-base-code');
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!extractor) {
    await initializeEmbeddingModel();
  }

  const result = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data as Float32Array);
}

// Initialize the model when the module is loaded.
initializeEmbeddingModel().catch(console.error);
```

---

### File 2: `src/tools/semantic_search/elasticsearch.ts`

This file contains the logic for connecting to Elasticsearch and performing the vector search.

```typescript
import { Client } from '@elastic/elasticsearch';

// This assumes the Elasticsearch client is configured elsewhere and imported.
// For this example, we'll create a new client.
const client = new Client({ node: process.env.ELASTICSEARCH_ENDPOINT || 'http://localhost:9200' });
const indexName = 'code-chunks'; // This should be the name of your index

export interface SearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
}

export async function searchCodeChunks(queryEmbedding: number[]): Promise<SearchResult[]> {
  const response = await client.search({
    index: indexName,
    knn: {
      field: 'embedding',
      query_vector: queryEmbedding,
      k: 10,
      num_candidates: 100,
    },
    _source: {
      excludes: ['embedding'],
    },
  });

  return response.hits.hits.map((hit: any) => ({
    ...hit._source,
    score: hit._score,
  }));
}
```

---

### File 3: `src/tools/semantic_search/index.ts`

This is the main file that defines the tool and registers it with the MCP server.

```typescript
import { z } from 'zod';
import { addTool } from '../../utils'; // Assuming addTool is in this location
import { ToolDefinition } from '../../types'; // Assuming ToolDefinition is in this location
import { generateEmbedding } from './embedding';
import { searchCodeChunks } from './elasticsearch';

// 1. Define the Zod schema for the tool's input.
const SemanticSearchInput = z.object({
  query: z.string().describe('The natural language search query.'),
});

// 2. Create the tool definition.
export const semanticSearchTool: ToolDefinition<typeof SemanticSearchInput> = {
  name: 'semanticCodeSearch',
  description: 'Searches the codebase using natural language to find semantically similar code chunks.',
  inputSchema: SemanticSearchInput,
  handler: async (input) => {
    console.log(`Generating embedding for query: "${input.query}"`);
    const queryEmbedding = await generateEmbedding(input.query);
    
    console.log('Searching for similar code chunks...');
    const results = await searchCodeChunks(queryEmbedding);

    return { results };
  },
};

// 3. Register the tool with the MCP server.
export const registerSemanticSearchTool = (server: McpServer) => {
  addTool(server, semanticSearchTool);
};
```

Please implement these three files. You will need to ensure the following prerequisites are met in the Kibana project:
1.  The `@elastic/elasticsearch` and `@xenova/transformers` packages are installed.
2.  The `jinaai/jina-embeddings-v2-base-code` model is downloaded locally and the `env.localModelPath` for transformers.js is configured correctly.
3.  The Elasticsearch connection details are configured, likely via environment variables.
4.  The import paths for `addTool` and `ToolDefinition` are correct.
