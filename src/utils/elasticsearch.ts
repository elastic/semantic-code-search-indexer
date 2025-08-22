import { Client, ClientOptions } from '@elastic/elasticsearch';
import { elasticsearchConfig } from '../config';

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
const elserPipelineName = 'elser_ingest_pipeline_2';
const elserModelId = elasticsearchConfig.model;

export async function setupElser(): Promise<void> {
  console.log('Checking for ELSER model and pipeline...');
  const pipelineExists = await client.ingest.getPipeline({ id: elserPipelineName }).catch(() => false);
  if (pipelineExists) {
    console.log('ELSER ingest pipeline already exists.');
    return;
  }
  try {
    await client.ml.getTrainedModels({ model_id: elserModelId });
  } catch (error) {
    console.error(`ELSER model '${elserModelId}' not found on the cluster.`);
    console.error('Please download it via the Kibana UI (Machine Learning > Trained Models) before running the indexer.');
    throw new Error('ELSER model not found.');
  }
  const stats = await client.ml.getTrainedModelsStats({ model_id: elserModelId });
  if (stats.trained_model_stats[0]?.deployment_stats?.state !== 'started') {
    console.log('Starting ELSER model deployment...');
    await client.ml.startTrainedModelDeployment({ model_id: elserModelId, wait_for: 'started' });
  }
  console.log('ELSER model is deployed.');
  console.log(`Creating ELSER ingest pipeline: ${elserPipelineName}...`);
  await client.ingest.putPipeline({
    id: elserPipelineName,
    description: 'Ingest pipeline for ELSER on code chunks',
    processors: [
      {
        inference: {
          model_id: elserModelId,
          input_output: [
            {
              input_field: 'embedding_text',
              output_field: 'content_embedding',
            },
          ],
        },
      },
      {
        remove: {
          field: 'embedding_text',
        },
      },
    ],
  });
  console.log('ELSER setup complete.');
}

export async function createIndex(): Promise<void> {
  const indexExists = await client.indices.exists({ index: indexName });
  if (!indexExists) {
    console.log(`Creating index "${indexName}"...`);
    await client.indices.create({
      index: indexName,
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
          content_embedding: { type: 'sparse_vector' },
          created_at: { type: 'date' },
          updated_at: { type: 'date' },
        },
      },
    });
  } else {
    console.log(`Index "${indexName}" already exists.`);
  }
}

export async function createSettingsIndex(): Promise<void> {
  const settingsIndexName = `${indexName}_settings`;
  const indexExists = await client.indices.exists({ index: settingsIndexName });
  if (!indexExists) {
    console.log(`Creating index "${settingsIndexName}"...`);
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
    console.log(`Index "${settingsIndexName}" already exists.`);
  }
}

export async function getLastIndexedCommit(branch: string): Promise<string | null> {
  const settingsIndexName = `${indexName}_settings`;
  try {
    const response = await client.get<{ commit_hash: string }>({
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
    body: {
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
  embedding_text: string;
  created_at: string;
  updated_at: string;
}

/**
 * Indexes an array of code chunks into Elasticsearch using the high-level bulk helper.
 */
export async function indexCodeChunks(chunks: CodeChunk[]): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  const operations = chunks.flatMap(doc => [{ index: { _index: indexName, pipeline: elserPipelineName } }, doc]);

  const bulkResponse = await client.bulk({ refresh: false, operations });

  if (bulkResponse.errors) {
    const erroredDocuments: any[] = [];
    // The items array has the same order of the dataset we just indexed.
    // The presence of the `error` key indicates that the operation
    // that we did for the document has failed.
    bulkResponse.items.forEach((action: any, i: number) => {
      const operation = Object.keys(action)[0];
      if (action[operation].error) {
        erroredDocuments.push({
          // If the status is 429 it means that you can retry the document,
          // otherwise it's very likely a mapping error, and you should
          // fix the document before to try it again.
          status: action[operation].status,
          error: action[operation].error,
          operation: operations[i * 2],
          document: operations[i * 2 + 1]
        });
      }
    });
    console.error('[ES Consumer] Errors during bulk indexing:', JSON.stringify(erroredDocuments, null, 2));
  }
}

export async function getClusterHealth(): Promise<any> {
  return client.cluster.health();
}

export async function searchCodeChunks(query: string): Promise<any[]> {
  const response = await client.search({
    index: indexName,
    query: {
      sparse_vector: {
        field: 'content_embedding',
        inference_id: elserModelId,
        query: query,
      },
    },
  } as any);
  return response.hits.hits.map((hit: any) => ({
    ...hit._source,
    score: hit._score,
  }));
}

export async function deleteIndex(): Promise<void> {
  const indexExists = await client.indices.exists({ index: indexName });
  if (indexExists) {
    console.log(`Deleting index "${indexName}"...`);
    await client.indices.delete({ index: indexName });
  } else {
    console.log(`Index "${indexName}" does not exist, skipping deletion.`);
  }
}

export async function deleteDocumentsByFilePath(filePath: string): Promise<void> {
  await client.deleteByQuery({
    index: indexName,
    q: `filePath:"${filePath}"`,
    refresh: true,
  });
}
