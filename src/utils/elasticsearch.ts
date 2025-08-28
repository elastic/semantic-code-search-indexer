import { Client, ClientOptions } from '@elastic/elasticsearch';
import { elasticsearchConfig } from '../config';
import { logger } from './logger';

let client: Client;

const baseOptions: Partial<ClientOptions> = {
  requestTimeout: 90000, // 90 seconds
};

if (elasticsearchConfig.cloudId) {
  client = new Client({
    ...baseOptions,
    cloud: {
      id: elasticsearchConfig.cloudId,
    },
    auth: {
      apiKey: elasticsearchConfig.apiKey || '',
    },
  });
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

const indexName = elasticsearchConfig.index;
const elserModelId = elasticsearchConfig.model;
const codeSimilarityPipeline = 'code-similarity-pipeline';

export async function setupElser(): Promise<void> {
  logger.info('Checking for ELSER model deployment...');
  try {
    const stats = await client.ml.getTrainedModelsStats({ model_id: elserModelId });
    if (stats.trained_model_stats[0]?.deployment_stats?.state !== 'started') {
      logger.info('Starting ELSER model deployment...');
      await client.ml.startTrainedModelDeployment({ model_id: elserModelId, wait_for: 'started' });
    }
    logger.info('ELSER model is deployed and ready.');
  } catch (error) {
    logger.error(`ELSER model '${elserModelId}' not found or failed to deploy.`, { error });
    logger.error('Please deploy it via the Kibana UI (Machine Learning > Trained Models) before running the indexer.');
    throw new Error('ELSER model setup failed.');
  }
}

export async function createIndex(): Promise<void> {
  const indexExists = await client.indices.exists({ index: indexName });
  if (!indexExists) {
    logger.info(`Creating index "${indexName}"...`);
    await client.indices.create({
      index: indexName,
      settings: {
        index: {
          default_pipeline: codeSimilarityPipeline,
        },
      },
      mappings: {
        properties: {
          type: { type: 'keyword' },
          language: { type: 'keyword' },
          kind: { type: 'keyword' },
          imports: { type: 'keyword' },
          containerPath: { type: 'text' },
          filePath: { type: 'keyword' },
          git_file_hash: { type: 'keyword' },
          git_branch: { type: 'keyword' },
          chunk_hash: { type: 'keyword' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          content: { type: 'text' },
          semantic_text: {
            type: 'semantic_text',
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

export async function createSettingsIndex(): Promise<void> {
  const settingsIndexName = `${indexName}_settings`;
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

export async function getLastIndexedCommit(branch: string): Promise<string | null> {
  const settingsIndexName = `${indexName}_settings`;
  try {
    const response = await client.get<{ commit_hash: string  }>({
      index: settingsIndexName,
      id: branch,
    });
    return response._source?.commit_hash ?? null;
  } catch (error: any) {
    if (error.meta?.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

export async function updateLastIndexedCommit(branch: string, commitHash: string): Promise<void> {
  const settingsIndexName = `${indexName}_settings`;
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

export interface CodeChunk {
  type: 'code' | 'doc';
  language: string;
  kind?: string;
  imports?: string[];
  containerPath?: string;
  filePath: string;
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

export async function indexCodeChunks(chunks: CodeChunk[]): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  const operations = chunks.flatMap(doc => [{ index: { _index: indexName } }, doc]);

  const bulkResponse = await client.bulk({ refresh: false, operations });

  if (bulkResponse.errors) {
    const erroredDocuments: any[] = [];
    bulkResponse.items.forEach((action: any, i: number) => {
      const operation = Object.keys(action)[0];
      if (action[operation].error) {
        erroredDocuments.push({
          status: action[operation].status,
          error: action[operation].error,
          operation: operations[i * 2],
          document: operations[i * 2 + 1]
        });
      }
    });
    logger.error('[ES Consumer] Errors during bulk indexing:', { errors: JSON.stringify(erroredDocuments, null, 2) });
  }
}

export async function getClusterHealth(): Promise<any> {
  return client.cluster.health();
}

export async function searchCodeChunks(query: string): Promise<any[]> {
  const response = await client.search({
    index: indexName,
    query: {
      semantic: {
        field: 'semantic_text',
        query: query,
      },
    },
  });
  return response.hits.hits.map((hit: any) => ({
    ...hit._source,
    score: hit._score,
  }));
}

export async function deleteIndex(): Promise<void> {
  const indexExists = await client.indices.exists({ index: indexName });
  if (indexExists) {
    logger.info(`Deleting index "${indexName}"...`);
    await client.indices.delete({ index: indexName });
  } else {
    logger.info(`Index "${indexName}" does not exist, skipping deletion.`);
  }
}

export async function deleteDocumentsByFilePath(filePath: string): Promise<void> {
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
