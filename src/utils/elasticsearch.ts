import { Client, ClientOptions } from '@elastic/elasticsearch';
import {
  ClusterHealthResponse,
  QueryDslQueryContainer,
  BulkOperationContainer,
  BulkOperationType,
  BulkResponseItem,
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
  const indexName = index ?? defaultIndexName;
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

  // Always try to create -repo alias if it doesn't exist (for both new and existing indices)
  // This ensures aliases are created for indices that were created before alias auto-creation was added
  await createRepoAlias(indexName);
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

/**
 * Validates that an index name is valid for Elasticsearch.
 * Elasticsearch index names must be lowercase, cannot contain certain characters,
 * and have length restrictions.
 *
 * @param name The index name to validate
 * @returns true if the name is valid, false otherwise
 */
function isValidIndexName(name: string): boolean {
  if (!name || name.trim().length === 0) {
    return false;
  }

  // Elasticsearch index name restrictions:
  // - Must be lowercase; uppercase characters are not allowed and will cause an error
  // - Cannot contain: \, /, *, ?, ", <, >, |, space
  // - Cannot start with: _, -, +
  // - Maximum length: 255 bytes
  if (name !== name.toLowerCase()) {
    return false;
  }

  const invalidChars = /[\\/*?"<>| ]/;
  const invalidStart = /^[_+-]/;

  if (invalidChars.test(name) || invalidStart.test(name)) {
    return false;
  }

  // Check length (255 bytes, but for simplicity we check UTF-8 length)
  // In practice, most index names are ASCII, so this is a reasonable check
  if (name.length > 255) {
    return false;
  }

  return true;
}

/**
 * Normalizes an index name by removing all trailing `-repo` segments.
 * This ensures index names don't end with `-repo`, allowing the `-repo` alias to be created successfully.
 * Elasticsearch does not allow an alias to have the same name as an index, so we strip `-repo` from
 * index names to ensure alias creation always works.
 *
 * @param name The index name to normalize
 * @returns The normalized index name with all trailing `-repo` segments removed
 * @example
 * removeRepoSegments('kibana-repo-repo-repo') // Returns 'kibana'
 * removeRepoSegments('kibana-repo') // Returns 'kibana'
 * removeRepoSegments('kibana') // Returns 'kibana' (no change)
 */
export function removeRepoSegments(name: string): string {
  // Remove all trailing `-repo` segments to ensure alias creation works
  // Use a while loop to handle multiple consecutive `-repo` segments
  let cleaned = name;
  while (cleaned.endsWith('-repo')) {
    cleaned = cleaned.slice(0, -5); // Remove '-repo' (5 characters)
  }
  return cleaned;
}

/**
 * Type guard to check if an error is an Elasticsearch error indicating a resource conflict.
 * This handles race conditions where an alias might have been created by another process.
 *
 * @param error The error to check
 * @returns true if the error indicates a resource already exists or conflict
 */
function isElasticsearchConflictError(error: unknown): boolean {
  // Check for 409 status code in meta
  if (
    error &&
    typeof error === 'object' &&
    'meta' in error &&
    error.meta &&
    typeof error.meta === 'object' &&
    'statusCode' in error.meta &&
    error.meta.statusCode === 409
  ) {
    return true;
  }

  // Check for error body with conflict error types
  if (
    error &&
    typeof error === 'object' &&
    'body' in error &&
    error.body &&
    typeof error.body === 'object' &&
    'error' in error.body &&
    error.body.error &&
    typeof error.body.error === 'object' &&
    'type' in error.body.error &&
    typeof error.body.error.type === 'string' &&
    (error.body.error.type === 'resource_already_exists_exception' ||
      error.body.error.type === 'illegal_argument_exception' ||
      error.body.error.type === 'invalid_alias_name_exception')
  ) {
    return true;
  }

  return false;
}

/**
 * Creates a -repo alias for the index to enable automatic discovery by the MCP server.
 *
 * This function creates an alias with the pattern `<indexName>-repo` pointing to the
 * main index. This allows the semantic-code-search-mcp-server to automatically discover
 * indices without requiring manual alias creation.
 *
 * The function automatically removes `-repo` segments from the index name before
 * creating the alias. For example, if the index is named `kibana-repo-repo-repo`, it will
 * normalize it to `kibana` and then create an alias `kibana-repo` pointing to it.
 *
 * @param index The index name (optional, defaults to configured index)
 * @example
 * await createRepoAlias('kibana'); // Creates 'kibana-repo' alias
 * await createRepoAlias('kibana-repo-repo'); // Creates 'kibana-repo' alias (normalized from 'kibana-repo-repo')
 */
export async function createRepoAlias(index?: string): Promise<void> {
  // Handle empty string by using default index name
  const indexName = index && index.trim().length > 0 ? index : defaultIndexName;

  // Validate index name
  if (!isValidIndexName(indexName)) {
    logger.warn(`Cannot create alias: invalid index name "${indexName}"`);
    return;
  }

  // Remove all trailing `-repo` segments from index name, then add one back for alias
  // This ensures alias is always <base-name>-repo, even if index name already has -repo
  // Note: Index names are already normalized in parseRepoArg(), but we handle non-normalized
  // names here for safety (e.g., if createRepoAlias is called directly)
  const baseIndexName = removeRepoSegments(indexName);

  // Log warning if normalization occurred (for direct calls to createRepoAlias)
  if (indexName !== baseIndexName) {
    logger.warn(`Index name "${indexName}" was normalized to "${baseIndexName}" `);
  }

  const aliasName = `${baseIndexName}-repo`;

  // Explicit length check for alias name (255 character limit) - check before validation
  // This provides a more specific error message for length issues
  if (aliasName.length > 255) {
    logger.warn(`Cannot create alias: alias name "${aliasName}" exceeds 255 character limit`);
    return;
  }

  // Validate alias name (same rules as index names)
  if (!isValidIndexName(aliasName)) {
    logger.warn(`Cannot create alias: generated alias name "${aliasName}" is invalid`);
    return;
  }

  try {
    // Check if alias already exists
    const aliasExists = await getClient().indices.existsAlias({
      name: aliasName,
    });

    if (aliasExists) {
      logger.info(`Alias "${aliasName}" already exists.`);
      return;
    }

    // Check if an index with the alias name already exists (conflict)
    // This prevents attempting to create an alias with a name that conflicts with an existing index.
    // Note: We only skip if the conflicting index is different from the target index.
    // If aliasName === baseIndexName, we still want to create the alias (though ES will reject it).
    if (aliasName !== baseIndexName) {
      const aliasNameIndexExists = await getClient().indices.exists({ index: aliasName });
      if (aliasNameIndexExists) {
        logger.warn(
          `Cannot create alias "${aliasName}": an index with this name already exists. ` +
            `The alias cannot be created because index names and alias names must be unique.`
        );
        return;
      }
    }

    // Verify the index exists before creating alias
    // Use baseIndexName (normalized) since that's what the actual index name would be
    const indexExists = await getClient().indices.exists({ index: baseIndexName });
    if (!indexExists) {
      logger.warn(`Cannot create alias "${aliasName}": index "${baseIndexName}" does not exist.`);
      return;
    }

    logger.info(`Creating alias "${aliasName}" pointing to index "${baseIndexName}"...`);
    try {
      await getClient().indices.putAlias({
        index: baseIndexName,
        name: aliasName,
      });
      logger.info(`Successfully created alias "${aliasName}"`);
    } catch (putAliasError: unknown) {
      // Handle race condition: alias might have been created by another process
      if (isElasticsearchConflictError(putAliasError)) {
        logger.info(`Alias "${aliasName}" was created by another process or already exists.`);
        return;
      }

      // Re-throw if it's a different error
      throw putAliasError;
    }
  } catch (error) {
    logger.error(`Failed to create alias "${aliasName}":`, { error });
    // Don't throw - alias creation is optional and shouldn't break indexing
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

/**
 * Result of a bulk indexing operation, separating succeeded and failed documents.
 */
export interface BulkIndexResult {
  /** Documents that were successfully indexed */
  succeeded: CodeChunk[];
  /** Documents that failed to index with their errors */
  failed: { chunk: CodeChunk; error: unknown }[];
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
  const operations = chunks.flatMap((doc) => [{ index: { _index: indexName, _id: doc.chunk_hash } }, doc]);

  const bulkOptions: { refresh: boolean; operations: (BulkOperationContainer | CodeChunk)[]; pipeline?: string } = {
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

    const succeeded: CodeChunk[] = [];
    const failed: { chunk: CodeChunk; error: unknown }[] = [];

    bulkResponse.items.forEach((action: Partial<Record<BulkOperationType, BulkResponseItem>>, i: number) => {
      const operationType = Object.keys(action)[0] as BulkOperationType;
      const result = action[operationType];
      const chunk = operations[i * 2 + 1] as CodeChunk;

      if (result?.error) {
        failed.push({
          chunk,
          error: result.error,
        });
      } else {
        succeeded.push(chunk);
      }
    });

    if (failed.length > 0) {
      logger.error(`Partial bulk failure: ${failed.length}/${chunks.length} documents failed`, {
        errors: JSON.stringify(
          failed.map((f) => ({ chunk_hash: f.chunk.chunk_hash, error: f.error })),
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
      failed: chunks.map((chunk) => ({ chunk, error })),
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
  const response = await getClient().search<unknown, FileAggregation>({
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
  await getClient().deleteByQuery({
    index: indexName,
    query: {
      term: {
        filePath: filePath,
      },
    },
    refresh: true,
  });
}
