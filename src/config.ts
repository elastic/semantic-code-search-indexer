import dotenv from 'dotenv';
import { env } from '@xenova/transformers';
import path from 'path';
import os from 'os';

dotenv.config();

export const elasticsearchConfig = {
  endpoint: process.env.ELASTICSEARCH_URL,
  cloudId: process.env.ELASTICSEARCH_CLOUD_ID,
  username: process.env.ELASTICSEARCH_USERNAME,
  password: process.env.ELASTICSEARCH_PASSWORD,
  apiKey: process.env.ELASTICSEARCH_API_KEY,
  model: process.env.ELASTICSEARCH_MODEL || '.elser_model_2',
  index: process.env.ELASTICSEARCH_INDEX || 'code-chunks',
};

export const indexingConfig = {
  batchSize: parseInt(process.env.BATCH_SIZE || '500', 10),
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '1000', 10),
  cpuCores: parseInt(process.env.CPU_CORES || `${Math.max(1, Math.floor(os.cpus().length / 2))}`, 10),
};

// Configure Xenova/Transformers.js
env.allowRemoteModels = false;
env.localModelPath = path.resolve(process.cwd(), 'models');
