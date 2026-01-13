import { Client, ClientOptions } from '@elastic/elasticsearch';
import {
  ClusterHealthResponse,
  QueryDslQueryContainer,
  BulkOperationContainer,
  BulkOperationType,
  BulkResponseItem,
  FieldValue,
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

// Test-only: allow deterministic one-time failures in integration tests.
const testIndexingThrownOnce = new Set<string>();

type ElasticsearchErrorSummary = {
  message?: string;
  type?: string;
  reason?: string;
  status?: number;
};

function summarizeElasticsearchError(error: unknown): ElasticsearchErrorSummary {
  if (typeof error === 'string') {
    return { message: error };
  }

  if (!error || typeof error !== 'object') {
    return { message: 'Unknown error' };
  }

  const e = error as {
    message?: unknown;
    meta?: unknown;
    type?: unknown;
    reason?: unknown;
  };

  const summary: ElasticsearchErrorSummary = {};

  if (typeof e.message === 'string') {
    summary.message = e.message;
  }

  // Many elasticsearch-js errors include large `meta.request.params.body` buffers.
  // Never log or persist the full error object. Extract only stable fields.
  if (e.meta && typeof e.meta === 'object') {
    const meta = e.meta as { statusCode?: unknown; body?: unknown };
    if (typeof meta.statusCode === 'number') {
      summary.status = meta.statusCode;
    }
    if (meta.body && typeof meta.body === 'object') {
      const body = meta.body as { error?: unknown };
      if (body.error && typeof body.error === 'object') {
        const bodyError = body.error as { type?: unknown; reason?: unknown };
        if (typeof bodyError.type === 'string') {
          summary.type = bodyError.type;
        }
        if (typeof bodyError.reason === 'string') {
          summary.reason = bodyError.reason;
        }
      }
    }
  }

  if (!summary.type && typeof e.type === 'string') {
    summary.type = e.type;
  }
  if (!summary.reason && typeof e.reason === 'string') {
    summary.reason = e.reason;
  }

  if (!summary.message) {
    if (summary.type || summary.reason) {
      summary.message = undefined;
    } else {
      summary.message = 'Elasticsearch request failed';
    }
  }

  return summary;
}

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
          chunk_hash: { type: 'keyword' },
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

function getLocationsIndexName(index?: string): string {
  return `${index || defaultIndexName}_locations`;
}

export interface ChunkLocation {
  /**
   * Stable chunk document id (sha256 of chunk identity).
   * This is the `_id` used in the main chunk index.
   */
  chunk_id: string;
  /** File path where this chunk exists (relative to repo root). */
  filePath: string;
  startLine: number;
  endLine: number;
  directoryPath?: string;
  directoryName?: string;
  directoryDepth?: number;
  git_file_hash?: string;
  git_branch?: string;
  updated_at: string;
}

export async function createLocationsIndex(index?: string): Promise<void> {
  const locationsIndexName = getLocationsIndexName(index);
  const indexExists = await getClient().indices.exists({ index: locationsIndexName });
  if (!indexExists) {
    logger.info(`Creating index "${locationsIndexName}"...`);
    await getClient().indices.create({
      index: locationsIndexName,
      mappings: {
        properties: {
          chunk_id: { type: 'keyword' },
          // Root field used for KQL filtering / discovery on the locations store.
          filePath: { type: 'wildcard' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          directoryPath: { type: 'keyword', eager_global_ordinals: true },
          directoryName: { type: 'keyword' },
          directoryDepth: { type: 'integer' },
          git_file_hash: { type: 'keyword' },
          git_branch: { type: 'keyword' },
          updated_at: { type: 'date' },
        },
      },
    });
  } else {
    logger.info(`Index "${locationsIndexName}" already exists.`);
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
  /**
   * File path for this chunk occurrence.
   *
   * NOTE: This field is only meaningful on input chunks (from the parser/queue).
   * The primary chunk index stores content-deduplicated documents and does not store per-file
   * location metadata. Per-file locations live in `<index>_locations`.
   */
  filePath?: string;
  directoryPath?: string;
  directoryName?: string;
  directoryDepth?: number;
  git_file_hash?: string;
  git_branch?: string;
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

function getChunkLocationDocumentId(location: {
  chunk_id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  git_branch?: string;
}): string {
  const stable = [
    location.chunk_id,
    location.filePath,
    String(location.startLine),
    String(location.endLine),
    location.git_branch ?? '',
  ].join(':');

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

  // Test-only hook: make it possible for integration tests to deterministically create
  // in-flight indexing work and exercise worker drain / concurrency scenarios.
  // This MUST remain a no-op in production.
  if (process.env.NODE_ENV === 'test') {
    // Optional: throw once when a chunk from a specific file path is present.
    // This lets us verify that the worker never leaves dequeued rows stuck in 'processing'
    // even if indexing throws unexpectedly mid-batch.
    const throwOnFilePath = process.env.TEST_INDEXING_THROW_ON_FILEPATH;
    if (throwOnFilePath) {
      const shouldThrow = chunks.some((c) => c.filePath === throwOnFilePath);
      if (shouldThrow && !testIndexingThrownOnce.has(throwOnFilePath)) {
        testIndexingThrownOnce.add(throwOnFilePath);
        throw new Error(`Test-only forced indexing failure for filePath=${throwOnFilePath}`);
      }
    }

    const delayMs = Number.parseInt(process.env.TEST_INDEXING_DELAY_MS ?? '', 10);
    if (Number.isFinite(delayMs) && delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const indexName = index || defaultIndexName;
  const now = new Date().toISOString();

  // 1) Validate input chunks and group by stable chunk document id (content-based).
  const groups = new Map<
    string,
    {
      id: string;
      baseChunk: CodeChunk;
      inputIndices: number[];
    }
  >();
  const chunkIdByInputIndex = new Map<number, string>();

  for (let i = 0; i < chunks.length; i++) {
    const doc = chunks[i];
    if (!doc) continue;
    if (!doc.filePath || typeof doc.filePath !== 'string' || doc.startLine == null || doc.endLine == null) {
      throw new Error(
        `indexCodeChunks received an input chunk without required file metadata (filePath/startLine/endLine). chunk_hash=${doc.chunk_hash}`
      );
    }

    const chunkId = getChunkDocumentId(doc);
    chunkIdByInputIndex.set(i, chunkId);

    const existing = groups.get(chunkId);
    if (existing) {
      existing.inputIndices.push(i);
    } else {
      groups.set(chunkId, { id: chunkId, baseChunk: doc, inputIndices: [i] });
    }
  }

  const succeeded: BulkIndexSucceeded[] = [];
  const failed: BulkIndexFailed[] = [];
  const failedInputIndices = new Map<number, unknown>();

  // 2) Create chunk documents (one per unique content) using bulk create.
  //
  // We intentionally avoid updating existing chunk docs to prevent expensive semantic_text re-inference.
  // If the doc already exists, bulk create returns 409, which we treat as success.
  const chunkIdsInOrder = Array.from(groups.keys());
  if (chunkIdsInOrder.length > 0) {
    const chunkOps: Array<BulkOperationContainer | Record<string, unknown>> = [];
    for (const chunkId of chunkIdsInOrder) {
      const group = groups.get(chunkId);
      if (!group) continue;

      const base = group.baseChunk;
      const chunkDoc: Record<string, unknown> = {
        type: base.type,
        language: base.language,
        kind: base.kind,
        imports: base.imports,
        symbols: base.symbols,
        exports: base.exports,
        containerPath: base.containerPath,
        chunk_hash: base.chunk_hash,
        content: base.content,
        semantic_text: base.semantic_text,
        code_vector: base.code_vector,
        created_at: now,
        updated_at: now,
      };

      chunkOps.push({ create: { _index: indexName, _id: chunkId } });
      chunkOps.push(chunkDoc);
    }

    const bulkOptions: {
      refresh: boolean;
      operations: Array<BulkOperationContainer | Record<string, unknown>>;
      pipeline?: string;
    } = {
      refresh: false,
      operations: chunkOps,
    };
    if (indexingConfig.enableDenseVectors) {
      bulkOptions.pipeline = codeSimilarityPipeline;
    }

    try {
      const chunkBulkResponse = await getClient().bulk(bulkOptions);

      chunkBulkResponse.items.forEach(
        (action: Partial<Record<BulkOperationType, BulkResponseItem>>, opIndex: number) => {
          const result = action.create;
          const chunkId = chunkIdsInOrder[opIndex];
          if (!chunkId) return;
          const group = groups.get(chunkId);
          if (!group) return;

          // 409 = document already exists; acceptable and expected for re-indexing.
          if (result?.status === 409) {
            return;
          }

          if (result?.error) {
            const summarized = summarizeElasticsearchError(result.error);
            for (const inputIndex of group.inputIndices) {
              failedInputIndices.set(inputIndex, summarized);
            }
          }
        }
      );
    } catch (error) {
      const summarized = summarizeElasticsearchError(error);
      logger.error('Exception during bulk indexing (chunk documents)', summarized);
      for (const chunkId of chunkIdsInOrder) {
        const group = groups.get(chunkId);
        if (!group) continue;
        for (const inputIndex of group.inputIndices) {
          failedInputIndices.set(inputIndex, summarized);
        }
      }
    }
  }

  // 3) Create/overwrite location documents (one per chunk occurrence).
  //
  // These docs are idempotent via a stable `_id` and are the authoritative source of truth for "where".
  const locationsIndexName = getLocationsIndexName(indexName);
  const locationIdsInOrder: string[] = [];
  const locationOps: Array<BulkOperationContainer | Record<string, unknown>> = [];
  const inputIndicesByLocationId = new Map<string, number[]>();

  for (let inputIndex = 0; inputIndex < chunks.length; inputIndex++) {
    if (failedInputIndices.has(inputIndex)) {
      continue;
    }
    const chunk = chunks[inputIndex];
    if (!chunk) continue;

    const chunkId = chunkIdByInputIndex.get(inputIndex);
    if (!chunkId) continue;

    const filePath = chunk.filePath;
    if (typeof filePath !== 'string' || chunk.startLine == null || chunk.endLine == null) {
      continue;
    }

    const locationId = getChunkLocationDocumentId({
      chunk_id: chunkId,
      filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      git_branch: chunk.git_branch,
    });

    const locationDoc: Record<string, unknown> = {
      chunk_id: chunkId,
      filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      directoryPath: chunk.directoryPath,
      directoryName: chunk.directoryName,
      directoryDepth: chunk.directoryDepth,
      git_file_hash: chunk.git_file_hash,
      git_branch: chunk.git_branch,
      updated_at: now,
    };

    const existing = inputIndicesByLocationId.get(locationId);
    if (existing) {
      existing.push(inputIndex);
      continue;
    }
    inputIndicesByLocationId.set(locationId, [inputIndex]);
    locationIdsInOrder.push(locationId);
    locationOps.push({ index: { _index: locationsIndexName, _id: locationId } });
    locationOps.push(locationDoc);
  }

  if (locationOps.length > 0) {
    try {
      const locationBulkResponse = await getClient().bulk({ refresh: false, operations: locationOps });
      locationBulkResponse.items.forEach(
        (action: Partial<Record<BulkOperationType, BulkResponseItem>>, opIndex: number) => {
          const result = action.index;
          if (!result?.error) return;

          const locationId = locationIdsInOrder[opIndex];
          if (!locationId) return;

          const summarized = summarizeElasticsearchError(result.error);
          const affectedInputIndices = inputIndicesByLocationId.get(locationId) ?? [];
          for (const inputIndex of affectedInputIndices) {
            failedInputIndices.set(inputIndex, summarized);
          }
        }
      );
    } catch (error) {
      const summarized = summarizeElasticsearchError(error);
      logger.error('Exception during bulk indexing (location documents)', summarized);
      for (const inputIndices of inputIndicesByLocationId.values()) {
        for (const inputIndex of inputIndices) {
          failedInputIndices.set(inputIndex, summarized);
        }
      }
    }
  }

  // 4) Build final per-input results.
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const error = failedInputIndices.get(i);
    if (error) {
      failed.push({ chunk, inputIndex: i, error });
    } else {
      succeeded.push({ chunk, inputIndex: i });
    }
  }

  // Stable ordering for deterministic tests / logs.
  succeeded.sort((a, b) => a.inputIndex - b.inputIndex);
  failed.sort((a, b) => a.inputIndex - b.inputIndex);

  logger.info(`Bulk operations completed for ${chunks.length} chunks`);

  if (failed.length > 0) {
    // Keep logs bounded: include only a small sample to avoid OOM on large/verbose errors.
    const sample = failed.slice(0, 5).map((f) => ({
      chunk_hash: f.chunk.chunk_hash,
      inputIndex: f.inputIndex,
      error: f.error,
    }));
    logger.error(`Partial bulk failure: ${failed.length}/${chunks.length} documents failed`, {
      sample,
    });
  }

  return { succeeded, failed };
}

export async function getClusterHealth(): Promise<ClusterHealthResponse> {
  return getClient().cluster.health();
}

export interface SearchResult extends CodeChunk {
  id: string;
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
  return response.hits.hits
    .filter((hit): hit is SearchHit<CodeChunk> & { _id: string } => typeof hit._id === 'string' && hit._id.length > 0)
    .map((hit) => ({
      id: hit._id,
      ...(hit._source as CodeChunk),
      score: hit._score ?? 0,
    }));
}

export type ChunkLocationSummary = {
  filePath: string;
  startLine: number;
  endLine: number;
};

export async function getLocationsForChunkIds(
  chunkIds: string[],
  options?: { index?: string; perChunkLimit?: number }
): Promise<Record<string, ChunkLocationSummary[]>> {
  const indexName = options?.index || defaultIndexName;
  const locationsIndexName = getLocationsIndexName(indexName);
  const perChunkLimit = Math.max(1, Math.min(50, Math.floor(options?.perChunkLimit ?? 5)));

  const uniqueChunkIds = Array.from(new Set(chunkIds)).filter((id) => typeof id === 'string' && id.length > 0);
  if (uniqueChunkIds.length === 0) {
    return {};
  }

  const client = getClient();
  const exists = await client.indices.exists({ index: locationsIndexName });
  if (!exists) {
    return {};
  }

  const response = await client.search({
    index: locationsIndexName,
    query: {
      terms: {
        chunk_id: uniqueChunkIds,
      },
    },
    size: 0,
    aggs: {
      by_chunk: {
        terms: {
          field: 'chunk_id',
          size: uniqueChunkIds.length,
        },
        aggs: {
          locations: {
            top_hits: {
              size: perChunkLimit,
              _source: ['filePath', 'startLine', 'endLine'],
              sort: [{ filePath: { order: 'asc' } }, { startLine: { order: 'asc' } }],
            },
          },
        },
      },
    },
  });

  const buckets = (
    response.aggregations as unknown as {
      by_chunk?: { buckets?: Array<{ key?: unknown; locations?: { hits?: { hits?: Array<{ _source?: unknown }> } } }> };
    }
  )?.by_chunk?.buckets;

  const result: Record<string, ChunkLocationSummary[]> = {};
  for (const bucket of buckets ?? []) {
    const chunkId = bucket.key;
    if (typeof chunkId !== 'string') {
      continue;
    }
    const hits = bucket.locations?.hits?.hits ?? [];
    const locations: ChunkLocationSummary[] = [];
    for (const h of hits) {
      const s = h._source as { filePath?: unknown; startLine?: unknown; endLine?: unknown } | undefined;
      if (!s) continue;
      if (typeof s.filePath !== 'string') continue;
      if (typeof s.startLine !== 'number') continue;
      if (typeof s.endLine !== 'number') continue;
      locations.push({ filePath: s.filePath, startLine: s.startLine, endLine: s.endLine });
    }
    result[chunkId] = locations;
  }

  return result;
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

export async function deleteLocationsIndex(index?: string): Promise<void> {
  const locationsIndexName = getLocationsIndexName(index);
  const indexExists = await getClient().indices.exists({ index: locationsIndexName });
  if (indexExists) {
    logger.info(`Deleting index "${locationsIndexName}"...`);
    await getClient().indices.delete({ index: locationsIndexName });
  } else {
    logger.info(`Index "${locationsIndexName}" does not exist, skipping deletion.`);
  }
}

const ELASTICSEARCH_TERMS_QUERY_BATCH_SIZE = 1000;

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    throw new Error(`Invalid chunkSize: ${chunkSize}`);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function deleteLocationsByFilePathsAndCollectChunkIds(
  filePaths: string[],
  indexName: string
): Promise<Set<string>> {
  const client = getClient();
  const locationsIndexName = getLocationsIndexName(indexName);

  const exists = await client.indices.exists({ index: locationsIndexName });
  if (!exists) {
    return new Set();
  }

  const deletePageSize = Math.max(1, Math.min(5000, Math.floor(indexingConfig.deleteDocumentsPageSize || 500)));
  const filePathTermsBatches = chunkArray(filePaths, ELASTICSEARCH_TERMS_QUERY_BATCH_SIZE);

  logger.info('Deleting locations for stale file paths', {
    indexName: locationsIndexName,
    filePathsCount: filePaths.length,
    filePathTermsBatches: filePathTermsBatches.length,
    deletePageSize,
  });

  // Use PIT + `_shard_doc` for stable pagination (and to keep memory bounded).
  // Keep PIT alive longer than a single request to reduce the chance of expiry during large deletes.
  const pitKeepAlive = '5m';
  const pit = await client.openPointInTime({ index: locationsIndexName, keep_alive: pitKeepAlive });
  const pitId = pit.id;

  const chunkIds = new Set<string>();
  let deletedAny = false;

  let searchAfter: FieldValue[] | undefined;
  const should: QueryDslQueryContainer[] = filePathTermsBatches.map((values) => ({
    terms: {
      filePath: values,
    },
  }));

  const startedAt = Date.now();
  let pages = 0;
  let deletedDocs = 0;
  let lastProgressAt = startedAt;

  try {
    while (true) {
      const searchStartedAt = Date.now();
      const response = await client.search<{ chunk_id?: string }>({
        pit: { id: pitId, keep_alive: pitKeepAlive },
        query: {
          bool: {
            should,
            minimum_should_match: 1,
          },
        },
        sort: ['_shard_doc'],
        search_after: searchAfter,
        // We don't need total hit counts for PIT scanning; disabling this reduces overhead.
        track_total_hits: false,
        size: deletePageSize,
        _source: ['chunk_id'],
      });

      const hits = response.hits.hits;
      if (hits.length === 0) {
        break;
      }
      pages += 1;

      const ops: BulkOperationContainer[] = [];
      for (const hit of hits) {
        const source = hit._source;
        const chunkId = source?.chunk_id;
        if (typeof chunkId === 'string' && chunkId.length > 0) {
          chunkIds.add(chunkId);
        }
        ops.push({ delete: { _index: locationsIndexName, _id: hit._id } });
      }

      if (ops.length > 0) {
        const bulkStartedAt = Date.now();
        const bulkResponse = await client.bulk({ refresh: false, operations: ops });
        const bulkDurationMs = Date.now() - bulkStartedAt;
        deletedAny = true;
        deletedDocs += ops.length;
        if (bulkResponse.errors) {
          logger.error('Bulk delete had errors during deleteLocationsByFilePaths', {
            indexName: locationsIndexName,
            filePaths: filePaths.slice(0, 10),
            filePathsCount: filePaths.length,
            errors: JSON.stringify(bulkResponse.items.slice(0, 50), null, 2),
          });
        }

        const now = Date.now();
        // Emit progress periodically so large deletes don't look hung.
        if (now - lastProgressAt >= 10_000) {
          const elapsedSec = Math.max(0.001, (now - startedAt) / 1000);
          logger.info('Deleting locations progress', {
            indexName: locationsIndexName,
            filePathsCount: filePaths.length,
            pages,
            deletedDocs,
            uniqueChunkIdsCollected: chunkIds.size,
            docsPerSec: Math.round(deletedDocs / elapsedSec),
            lastSearchMs: Date.now() - searchStartedAt,
            lastBulkMs: bulkDurationMs,
          });
          lastProgressAt = now;
        }
      }

      const lastSort = hits[hits.length - 1]?.sort;
      if (
        Array.isArray(lastSort) &&
        lastSort.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
      ) {
        searchAfter = lastSort as FieldValue[];
      } else {
        searchAfter = undefined;
      }
    }
  } finally {
    await client.closePointInTime({ id: pitId });
  }

  // Ensure the deletions are visible for subsequent orphan checks.
  if (deletedAny) {
    await client.indices.refresh({ index: locationsIndexName });
  }

  logger.info('Finished deleting locations for stale file paths', {
    indexName: locationsIndexName,
    filePathsCount: filePaths.length,
    pages,
    deletedDocs,
    uniqueChunkIdsCollected: chunkIds.size,
    durationMs: Date.now() - startedAt,
  });

  return chunkIds;
}

async function deleteOrphanChunkDocuments(chunkIds: string[], indexName: string): Promise<void> {
  if (chunkIds.length === 0) {
    return;
  }

  const client = getClient();
  const locationsIndexName = getLocationsIndexName(indexName);

  for (const chunk of chunkArray(chunkIds, ELASTICSEARCH_TERMS_QUERY_BATCH_SIZE)) {
    const response = await client.search({
      index: locationsIndexName,
      query: {
        terms: {
          chunk_id: chunk,
        },
      },
      size: 0,
      track_total_hits: true,
      aggs: {
        present: {
          terms: {
            field: 'chunk_id',
            size: chunk.length,
          },
        },
      },
    });

    const buckets = (response.aggregations as unknown as { present?: { buckets?: Array<{ key?: unknown }> } })?.present
      ?.buckets;
    const presentIds = new Set<string>();
    for (const b of buckets ?? []) {
      if (typeof b.key === 'string') {
        presentIds.add(b.key);
      }
    }

    const toDelete = chunk.filter((id) => !presentIds.has(id));
    if (toDelete.length === 0) {
      continue;
    }

    const ops: BulkOperationContainer[] = toDelete.map((id) => ({ delete: { _index: indexName, _id: id } }));
    const bulkResponse = await client.bulk({ refresh: false, operations: ops });
    if (bulkResponse.errors) {
      logger.error('Bulk delete had errors during deleteOrphanChunkDocuments', {
        indexName,
        count: toDelete.length,
        errors: JSON.stringify(bulkResponse.items.slice(0, 50), null, 2),
      });
    }
  }
}

export async function deleteDocumentsByFilePaths(filePaths: string[], index?: string): Promise<void> {
  const indexName = index || defaultIndexName;
  // Locations are authoritative in `<index>_locations`. The primary chunk documents do not store
  // per-file locations; we delete orphan chunk docs when their last location is removed.

  const uniqueFilePaths = Array.from(new Set(filePaths)).filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  );
  if (uniqueFilePaths.length === 0) {
    return;
  }
  const affectedChunkIds = await deleteLocationsByFilePathsAndCollectChunkIds(uniqueFilePaths, indexName);
  await deleteOrphanChunkDocuments(Array.from(affectedChunkIds), indexName);
}

export async function deleteDocumentsByFilePath(filePath: string, index?: string): Promise<void> {
  await deleteDocumentsByFilePaths([filePath], index);
}
