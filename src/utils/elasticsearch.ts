import { Client } from '@elastic/elasticsearch';
import { elasticsearchConfig } from '../config';

const clientOptions = {
  node: elasticsearchConfig.endpoint,
  requestTimeout: 90000, // 90 seconds
};

let client: Client;

if (elasticsearchConfig.apiKey) {
  client = new Client({
    ...clientOptions,
    auth: {
      apiKey: elasticsearchConfig.apiKey,
    },
  });
} else if (elasticsearchConfig.username && elasticsearchConfig.password) {
  client = new Client({
    ...clientOptions,
    auth: {
      username: elasticsearchConfig.username,
      password: elasticsearchConfig.password,
    },
  });
} else {
  client = new Client(clientOptions);
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
              input_field: 'content',
              output_field: 'content_embedding',
            },
          ],
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
          filePath: { type: 'keyword' },
          git_file_hash: { type: 'keyword' },
          git_branch: { type: 'keyword' },
          chunk_hash: { type: 'keyword' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          content: { type: 'text' },
          content_embedding: { type: 'sparse_vector' },
        },
      },
    });
  } else {
    console.log(`Index "${indexName}" already exists.`);
  }
}

export interface CodeChunk {
  filePath: string;
  git_file_hash: string;
  git_branch: string;
  chunk_hash: string;
  startLine: number;
  endLine: number;
  content: string;
}

/**
 * Indexes an array of code chunks into Elasticsearch using the high-level bulk helper.
 */
export async function indexCodeChunks(chunks: CodeChunk[]): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  const bulkHelper = client.helpers.bulk({
    datasource: chunks,
    pipeline: elserPipelineName,
    onDocument(doc) {
      return { index: { _index: indexName } };
    },
    onDrop(doc) {
      console.error('[ES Consumer] Document dropped:', doc);
    },
  });

  await bulkHelper;
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
