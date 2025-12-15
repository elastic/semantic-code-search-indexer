import { Client, ClientOptions } from '@elastic/elasticsearch';
import {
  ClusterHealthResponse,
  QueryDslQueryContainer,
  BulkOperationContainer,
  BulkOperationType,
  BulkResponseItem,
} from '@elastic/elasticsearch/lib/api/types';
import { createHash } from 'crypto';
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
let _client: Client | undefined;

/**
 * Sets the Elasticsearch client instance (for testing purposes).
 * @internal
 */
export function setClient(client: Client | undefined): void {
  _client = client;
}

/**
 * Gets the Elasticsearch client instance, initializing it if necessary.
 * This lazy initialization allows commands that don't need Elasticsearch
 * to run without requiring Elasticsearch configuration.
 */
export function getClient(): Client {
  if (_client) {
    return _client;
  }

  const baseOptions: Partial<ClientOptions> = {
    requestTimeout: parseInt(process.env.ELASTICSEARCH_REQUEST_TIMEOUT || '90000', 10),
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

    _client = new Client(clientOptions);
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
    _client = new Client(clientOptions);
  } else {
    throw new Error(
      'Elasticsearch connection not configured. Please set ELASTICSEARCH_CLOUD_ID or ELASTICSEARCH_ENDPOINT.'
    );
  }

  return _client;
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
  const indexExists = await getClient().indices.exists({ index: indexName });
  if (!indexExists) {
    logger.info(`Creating index "${indexName}"...`);
    await getClient().indices.create({
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
          filePath: { type: 'keyword' }, // Legacy field
          directoryPath: { type: 'keyword', eager_global_ordinals: true },
          directoryName: { type: 'keyword' },
          directoryDepth: { type: 'integer' },
          git_file_hash: { type: 'keyword' },
          git_branch: { type: 'keyword' },
          chunk_hash: { type: 'keyword' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          // New fields for path aggregation
          fileCount: { type: 'integer' },
          filePaths: {
            type: 'nested',
            properties: {
              path: { type: 'keyword' },
              startLine: { type: 'integer' },
              endLine: { type: 'integer' },
              directoryPath: { type: 'keyword' },
              directoryName: { type: 'keyword' },
              directoryDepth: { type: 'integer' },
              git_file_hash: { type: 'keyword' },
              git_branch: { type: 'keyword' },
            },
          },
          content: { type: 'text' },
          ...(process.env.DISABLE_SEMANTIC_TEXT !== 'true' && {
            semantic_text: {
              type: 'semantic_text',
              inference_id: elserInferenceId,
            },
          }),
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
  const indexExists = await getClient().indices.exists({ index: settingsIndexName });
  if (!indexExists) {
    logger.info(`Creating index "${settingsIndexName}"...`);
    await getClient().indices.create({
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
    const response = await getClient().get<{ commit_hash: string }>({
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
  await getClient().index({
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
  // Deprecated: use filePaths array instead
  filePath?: string;
  directoryPath?: string;
  directoryName?: string;
  directoryDepth?: number;
  git_file_hash?: string;
  git_branch?: string;
  // New field for aggregation
  filePaths?: {
    path: string;
    startLine: number;
    endLine: number;
    directoryPath?: string;
    directoryName?: string;
    directoryDepth?: number;
    git_file_hash?: string;
    git_branch?: string;
  }[];
  fileCount?: number;
  chunk_hash: string;
  startLine?: number;
  endLine?: number;
  content: string;
  semantic_text: string;
  code_vector?: number[];
  created_at: string;
  updated_at: string;
}

/**
 * Produces a stable Elasticsearch document id for a chunk.
 *
 * Uses SHA256(content + language + type + kind + containerPath) to ensure identical code
 * from different files maps to the same document.
 */
function getChunkDocumentId(chunk: CodeChunk): string {
  // IMPORTANT: Do NOT include file-specific metadata (path, branch, line numbers)
  // in the hash input. This ensures identical content shares the same ID.
  const stable = [chunk.type, chunk.language, chunk.kind ?? '', chunk.containerPath ?? '', chunk.content].join(':');

  return createHash('sha256').update(stable).digest('hex');
}

/**
 * Result of a bulk indexing operation, separating succeeded and failed documents.
 */
export interface BulkIndexSucceeded {
  /** Original input chunk that was indexed */
  chunk: CodeChunk;
  /** Index of the chunk in the original `chunks` input array */
  inputIndex: number;
}

export interface BulkIndexFailed {
  /** Original input chunk that failed to index */
  chunk: CodeChunk;
  /** Index of the chunk in the original `chunks` input array */
  inputIndex: number;
  /** Elasticsearch error information for this item */
  error: unknown;
}

export interface BulkIndexResult {
  /** Documents that were successfully indexed */
  succeeded: BulkIndexSucceeded[];
  /** Documents that failed to index with their errors */
  failed: BulkIndexFailed[];
}

/**
 * Indexes an array of code chunks into Elasticsearch.
 *
 * This function uses the Elasticsearch bulk API to efficiently index a large
 * number of documents at once. Returns a result object with succeeded and failed
 * documents to allow granular handling of partial failures.
 *
 * On complete failures (network errors, cluster unavailable), returns all chunks
 * as failed rather than throwing.
 *
 * @param chunks An array of `CodeChunk` objects to index.
 * @returns A `BulkIndexResult` with succeeded and failed documents.
 */
export async function indexCodeChunks(chunks: CodeChunk[], index?: string): Promise<BulkIndexResult> {
  if (chunks.length === 0) {
    return { succeeded: [], failed: [] };
  }

  const indexName = index || defaultIndexName;

  // Transform chunks into update/upsert operations
  const operations = chunks.flatMap((doc) => {
    // The indexer pipeline is expected to always enqueue chunks with file-specific metadata.
    // Keep `CodeChunk` fields optional because indexed *documents* can be aggregated across files,
    // but the *input* to indexing must include a file path and line range to update filePaths.
    if (!doc.filePath || doc.startLine == null || doc.endLine == null) {
      throw new Error(
        `indexCodeChunks received an input chunk without required file metadata (filePath/startLine/endLine). chunk_hash=${doc.chunk_hash}`
      );
    }

    // Extract file-specific info to add to filePaths
    const pathInfo = {
      path: doc.filePath,
      startLine: doc.startLine,
      endLine: doc.endLine,
      directoryPath: doc.directoryPath,
      directoryName: doc.directoryName,
      directoryDepth: doc.directoryDepth,
      git_file_hash: doc.git_file_hash,
      git_branch: doc.git_branch,
    };

    // Prepare the base document for upsert (if it doesn't exist)
    // Initialize filePaths with the current path info
    const upsertDoc = {
      ...doc,
      filePaths: [pathInfo],
      fileCount: 1,
    };

    // Remove flat fields from upsertDoc if desired, or keep them as "primary"
    // For now, we keep them as they are required by the CodeChunk interface

    return [
      { update: { _index: indexName, _id: getChunkDocumentId(doc) } },
      {
        script: {
          source: `
            // Check if path already exists in filePaths
            boolean exists = false;
            if (ctx._source.filePaths != null) {
              for (item in ctx._source.filePaths) {
                if (item.path == params.pathInfo.path && item.startLine == params.pathInfo.startLine) {
                  exists = true;
                  break;
                }
              }
            } else {
              ctx._source.filePaths = [];
            }
            
            // Append if not exists
            if (!exists) {
              ctx._source.filePaths.add(params.pathInfo);
              if (ctx._source.fileCount == null) {
                ctx._source.fileCount = 1;
              } else {
                ctx._source.fileCount += 1;
              }
            }
          `,
          lang: 'painless',
          params: {
            pathInfo: pathInfo,
          },
        },
        upsert: upsertDoc,
      },
    ];
  });

  const bulkOptions: {
    refresh: boolean;
    operations: Array<BulkOperationContainer | Record<string, unknown>>;
    pipeline?: string;
  } = {
    refresh: false,
    operations,
  };

  if (indexingConfig.enableDenseVectors) {
    bulkOptions.pipeline = codeSimilarityPipeline;
  }

  try {
    logger.info(`Indexing ${chunks.length} chunks to ${indexName}...`);
    const bulkResponse = await getClient().bulk(bulkOptions);
    logger.info(`Bulk operation completed for ${chunks.length} chunks`);

    const succeeded: BulkIndexSucceeded[] = [];
    const failed: BulkIndexFailed[] = [];

    bulkResponse.items.forEach((action: Partial<Record<BulkOperationType, BulkResponseItem>>, i: number) => {
      // The result key will be 'update' (or 'create'/'index' if we used those)
      // Since we use 'update', look for that.
      const operationType = Object.keys(action)[0] as BulkOperationType;
      const result = action[operationType];
      const chunk = chunks[i];
      if (!chunk) {
        return;
      }

      if (result?.error) {
        failed.push({
          chunk,
          inputIndex: i,
          error: result.error,
        });
      } else {
        succeeded.push({ chunk, inputIndex: i });
      }
    });

    if (failed.length > 0) {
      logger.error(`Partial bulk failure: ${failed.length}/${chunks.length} documents failed`, {
        errors: JSON.stringify(
          failed.map((f) => ({ chunk_hash: f.chunk.chunk_hash, inputIndex: f.inputIndex, error: f.error })),
          null,
          2
        ),
      });
    }

    return { succeeded, failed };
  } catch (error) {
    // Complete failure (network, cluster down, etc.) - all documents failed
    logger.error('Exception during bulk indexing:', { error });
    return {
      succeeded: [],
      failed: chunks.map((chunk, inputIndex) => ({ chunk, inputIndex, error })),
    };
  }
}

export async function getClusterHealth(): Promise<ClusterHealthResponse> {
  return getClient().cluster.health();
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
  const response = await getClient().search<CodeChunk>({
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
    paths: {
      buckets: {
        key: string;
        to_root: {
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
        };
      }[];
    };
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
  const response = await getClient().search<unknown, FileAggregation>({
    index: indexName,
    query,
    aggs: {
      files: {
        nested: {
          path: 'filePaths',
        },
        aggs: {
          paths: {
            terms: {
              field: 'filePaths.path',
              size: 1000,
            },
            aggs: {
              to_root: {
                reverse_nested: {},
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
          },
        },
      },
    },
    size: 0,
  });

  const results: Record<string, SymbolInfo[]> = {};
  if (response.aggregations) {
    const files = response.aggregations;
    for (const bucket of files.files.paths.buckets) {
      const filePath = bucket.key;
      const symbols: SymbolInfo[] = bucket.to_root.symbols.names.buckets.map((b) => ({
        name: b.key,
        kind: b.kind.buckets[0]?.key ?? 'symbol',
        line: b.line.buckets[0]?.key ?? 0,
      }));
      results[filePath] = symbols;
    }
  }

  return results;
}

export async function deleteIndex(index?: string): Promise<void> {
  const indexName = index || defaultIndexName;
  const indexExists = await getClient().indices.exists({ index: indexName });
  if (indexExists) {
    logger.info(`Deleting index "${indexName}"...`);
    await getClient().indices.delete({ index: indexName });
  } else {
    logger.info(`Index "${indexName}" does not exist, skipping deletion.`);
  }
}

export async function deleteDocumentsByFilePath(filePath: string, index?: string): Promise<void> {
  const indexName = index || defaultIndexName;
  await getClient().updateByQuery({
    index: indexName,
    query: {
      nested: {
        path: 'filePaths',
        query: {
          term: {
            'filePaths.path': filePath,
          },
        },
      },
    },
    script: {
      source: `
        if (ctx._source.filePaths != null) {
          ctx._source.filePaths.removeIf(item -> item.path == params.path);
          ctx._source.fileCount = ctx._source.filePaths.size();
          if (ctx._source.filePaths.size() == 0) {
            ctx.op = "delete";
          }
        }
      `,
      lang: 'painless',
      params: {
        path: filePath,
      },
    },
    refresh: true,
  });
}
