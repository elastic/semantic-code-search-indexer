import { Client, ClientOptions } from '@elastic/elasticsearch';
import {
  ClusterHealthResponse,
  QueryDslQueryContainer,
  BulkOperationContainer,
} from '@elastic/elasticsearch/lib/api/types';
import { elasticsearchConfig, indexingConfig } from '../config';
export { elasticsearchConfig };
import { logger } from './logger';

/**
 * The Elasticsearch client instance.
 *
 * This client is configured to connect to the Elasticsearch cluster specified
 * in the environment variables. It is used for all communication with
 * Elasticsearch.
 */
export let client: Client;

const baseOptions: Partial<ClientOptions> = {
  requestTimeout: 90000, // 90 seconds
};

if (elasticsearchConfig.cloudId) {
  const clientOptions: ClientOptions = {
    ...baseOptions,
    cloud: {
      id: elasticsearchConfig.cloudId,
    },
  };

  if (elasticsearchConfig.apiKey) {
    clientOptions.auth = { apiKey: elasticsearchConfig.apiKey };
  } else if (elasticsearchConfig.username && elasticsearchConfig.password) {
    clientOptions.auth = {
      username: elasticsearchConfig.username,
      password: elasticsearchConfig.password,
    };
  } else {
    throw new Error(
      'Elasticsearch Cloud authentication not configured. Please set ELASTICSEARCH_API_KEY or ELASTICSEARCH_USER and ELASTICSEARCH_PASSWORD.'
    );
  }

  client = new Client(clientOptions);
} else if (elasticsearchConfig.endpoint) {
  const clientOptions: ClientOptions = {
    ...baseOptions,
    node: elasticsearchConfig.endpoint,
  };

  if (elasticsearchConfig.apiKey) {
    clientOptions.auth = { apiKey: elasticsearchConfig.apiKey };
  } else if (elasticsearchConfig.username && elasticsearchConfig.password) {
    clientOptions.auth = {
      username: elasticsearchConfig.username,
      password: elasticsearchConfig.password,
    };
  }
  client = new Client(clientOptions);
} else {
  throw new Error(
    'Elasticsearch connection not configured. Please set ELASTICSEARCH_CLOUD_ID or ELASTICSEARCH_ENDPOINT.'
  );
}

const defaultIndexName = elasticsearchConfig.index;
const elserInferenceId = elasticsearchConfig.inferenceId;
const codeSimilarityPipeline = 'code-similarity-pipeline';

/**
 * Creates the Elasticsearch index for storing code chunks.
 *
 * This function checks if the index already exists. If it doesn't, it creates
 * the index with the correct mappings for the code chunk documents.
 */
export async function createIndex(index?: string): Promise<void> {
  const indexName = index || defaultIndexName;
  const indexExists = await client.indices.exists({ index: indexName });
  if (!indexExists) {
    logger.info(`Creating index "${indexName}"...`);
    await client.indices.create({
      index: indexName,
      mappings: {
        properties: {
          type: { type: 'keyword' },
          language: { type: 'keyword' },
          kind: { type: 'keyword' },
          imports: {
            type: 'nested',
            properties: {
              path: { type: 'keyword' },
              type: { type: 'keyword' },
              symbols: { type: 'keyword' },
            },
          },
          symbols: {
            type: 'nested',
            properties: {
              name: { type: 'keyword' },
              kind: { type: 'keyword' },
              line: { type: 'integer' },
            },
          },
          exports: {
            type: 'nested',
            properties: {
              name: { type: 'keyword' },
              type: { type: 'keyword' },
              target: { type: 'keyword' },
            },
          },
          containerPath: { type: 'text' },
          filePath: { type: 'keyword' },
          directoryPath: { type: 'keyword', eager_global_ordinals: true },
          directoryName: { type: 'keyword' },
          directoryDepth: { type: 'integer' },
          git_file_hash: { type: 'keyword' },
          git_branch: { type: 'keyword' },
          chunk_hash: { type: 'keyword' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          content: { type: 'text' },
          semantic_text: {
            type: 'semantic_text',
            inference_id: elserInferenceId,
          },
          code_vector: {
            type: 'dense_vector',
            dims: 768, // Based on microsoft/codebert-base
            index: true,
            similarity: 'cosine',
          },
          created_at: { type: 'date' },
          updated_at: { type: 'date' },
        },
      },
    });
  } else {
    logger.info(`Index "${indexName}" already exists.`);
  }
}

export async function createSettingsIndex(index?: string): Promise<void> {
  const settingsIndexName = `${index || defaultIndexName}_settings`;
  const indexExists = await client.indices.exists({ index: settingsIndexName });
  if (!indexExists) {
    logger.info(`Creating index "${settingsIndexName}"...`);
    await client.indices.create({
      index: settingsIndexName,
      mappings: {
        properties: {
          branch: { type: 'keyword' },
          commit_hash: { type: 'keyword' },
          updated_at: { type: 'date' },
        },
      },
    });
  } else {
    logger.info(`Index "${settingsIndexName}" already exists.`);
  }
}

export async function getLastIndexedCommit(branch: string, index?: string): Promise<string | null> {
  const settingsIndexName = `${index || defaultIndexName}_settings`;
  try {
    const response = await client.get<{ commit_hash: string }>({
      index: settingsIndexName,
      id: branch,
    });
    return response._source?.commit_hash ?? null;
  } catch (error: unknown) {
    if (error instanceof Error && 'meta' in error && (error.meta as { statusCode?: number }).statusCode === 404) {
      return null;
    }
    throw error;
  }
}

export async function updateLastIndexedCommit(branch: string, commitHash: string, index?: string): Promise<void> {
  const settingsIndexName = `${index || defaultIndexName}_settings`;
  await client.index({
    index: settingsIndexName,
    id: branch,
    document: {
      branch,
      commit_hash: commitHash,
      updated_at: new Date().toISOString(),
    },
    refresh: true,
  });
}

export interface SymbolInfo {
  name: string;
  kind: string;
  line: number;
}

export interface ExportInfo {
  name: string;
  type: 'named' | 'default' | 'namespace';
  target?: string;
}

export interface CodeChunk {
  type: 'code' | 'doc';
  language: string;
  kind?: string;
  imports?: { path: string; type: 'module' | 'file'; symbols?: string[] }[];
  symbols?: SymbolInfo[];
  exports?: ExportInfo[];
  containerPath?: string;
  filePath: string;
  directoryPath: string;
  directoryName: string;
  directoryDepth: number;
  git_file_hash: string;
  git_branch: string;
  chunk_hash: string;
  startLine: number;
  endLine: number;
  content: string;
  semantic_text: string;
  code_vector?: number[];
  created_at: string;
  updated_at: string;
}

interface ErroredDocument {
  status: number;
  // The structure of the error object from the Elasticsearch client can be complex and varied, making it difficult to type statically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any;
  operation: { index: { _index: string } };
  document: CodeChunk;
}

/**
 * Indexes an array of code chunks into Elasticsearch.
 *
 * This function uses the Elasticsearch bulk API to efficiently index a large
 * number of documents at once.
 *
 * @param chunks An array of `CodeChunk` objects to index.
 */
export async function indexCodeChunks(chunks: CodeChunk[], index?: string): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  const indexName = index || defaultIndexName;
  const operations = chunks.flatMap((doc) => [{ index: { _index: indexName, _id: doc.chunk_hash } }, doc]);

  const bulkOptions: { refresh: boolean; operations: (BulkOperationContainer | CodeChunk)[]; pipeline?: string } = {
    refresh: false,
    operations,
  };

  if (indexingConfig.enableDenseVectors) {
    bulkOptions.pipeline = codeSimilarityPipeline;
  }

  const bulkResponse = await client.bulk(bulkOptions);

  if (bulkResponse.errors) {
    const erroredDocuments: ErroredDocument[] = [];
    // The `action` object from the Elasticsearch bulk response has a dynamic structure
    // (e.g., { index: { ... } }, { create: { ... } }) which is difficult to type
    // statically without overly complex type guards.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bulkResponse.items.forEach((action: any, i: number) => {
      const operation = Object.keys(action)[0];
      if (action[operation].error) {
        erroredDocuments.push({
          status: action[operation].status,
          error: action[operation].error,
          operation: operations[i * 2] as { index: { _index: string } },
          document: operations[i * 2 + 1] as CodeChunk,
        });
      }
    });
    logger.error('Errors during bulk indexing:', { errors: JSON.stringify(erroredDocuments, null, 2) });
    throw new Error(
      `Bulk indexing failed: ${erroredDocuments.length} of ${chunks.length} documents had errors. ` +
        `First error: ${JSON.stringify(erroredDocuments[0]?.error)}`
    );
  }
}

export async function getClusterHealth(): Promise<ClusterHealthResponse> {
  return client.cluster.health();
}

export interface SearchResult extends CodeChunk {
  score: number;
}

/**
 * Performs a semantic search on the code chunks in the index.
 *
 * @param query The natural language query to search for.
 * @returns A promise that resolves to an array of search results.
 */
import { SearchHit } from '@elastic/elasticsearch/lib/api/types';

// ... existing code ...

export async function searchCodeChunks(query: string, index?: string): Promise<SearchResult[]> {
  const indexName = index || defaultIndexName;
  const response = await client.search<CodeChunk>({
    index: indexName,
    query: {
      semantic: {
        field: 'semantic_text',
        query: query,
      },
    },
  });
  return response.hits.hits.map((hit: SearchHit<CodeChunk>) => ({
    ...(hit._source as CodeChunk),
    score: hit._score ?? 0,
  }));
}

/**
 * Aggregates symbols by file path.
 *
 * This function is used by the `symbol_analysis` tool to find all the symbols
 * in a set of files that match a given query.
 *
 * @param query The Elasticsearch query to use for the search.
 * @returns A promise that resolves to a record of file paths to symbol info.
 */
interface FileAggregation {
  files: {
    buckets: {
      key: string;
      symbols: {
        names: {
          buckets: {
            key: string;
            kind: {
              buckets: {
                key: string;
              }[];
            };
            line: {
              buckets: {
                key: number;
              }[];
            };
          }[];
        };
      };
    }[];
  };
}

/**
 * Aggregates symbols by file path.
 *
 * This function is used by the `symbol_analysis` tool to find all the symbols
 * in a set of files that match a given query.
 *
 * @param query The Elasticsearch query to use for the search.
 * @returns A promise that resolves to a record of file paths to symbol info.
 */
export async function aggregateBySymbols(
  query: QueryDslQueryContainer,
  index?: string
): Promise<Record<string, SymbolInfo[]>> {
  const indexName = index || defaultIndexName;
  const response = await client.search<unknown, FileAggregation>({
    index: indexName,
    query,
    aggs: {
      files: {
        terms: {
          field: 'filePath',
          size: 1000,
        },
        aggs: {
          symbols: {
            nested: {
              path: 'symbols',
            },
            aggs: {
              names: {
                terms: {
                  field: 'symbols.name',
                  size: 1000,
                },
                aggs: {
                  kind: {
                    terms: {
                      field: 'symbols.kind',
                      size: 1,
                    },
                  },
                  line: {
                    terms: {
                      field: 'symbols.line',
                      size: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    size: 0,
  });

  const results: Record<string, SymbolInfo[]> = {};
  if (response.aggregations) {
    const files = response.aggregations;
    for (const bucket of files.files.buckets) {
      const filePath = bucket.key;
      const symbols: SymbolInfo[] = bucket.symbols.names.buckets.map((b) => ({
        name: b.key,
        kind: b.kind.buckets[0].key,
        line: b.line.buckets[0].key,
      }));
      results[filePath] = symbols;
    }
  }

  return results;
}

export async function deleteIndex(index?: string): Promise<void> {
  const indexName = index || defaultIndexName;
  const indexExists = await client.indices.exists({ index: indexName });
  if (indexExists) {
    logger.info(`Deleting index "${indexName}"...`);
    await client.indices.delete({ index: indexName });
  } else {
    logger.info(`Index "${indexName}" does not exist, skipping deletion.`);
  }
}

export async function deleteDocumentsByFilePath(filePath: string, index?: string): Promise<void> {
  const indexName = index || defaultIndexName;
  await client.deleteByQuery({
    index: indexName,
    query: {
      term: {
        filePath: filePath,
      },
    },
    refresh: true,
  });
}
