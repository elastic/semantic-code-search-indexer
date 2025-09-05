import dotenv from 'dotenv';
import path from 'path';
import os from 'os';

dotenv.config({ quiet: true });

export const elasticsearchConfig = {
  endpoint: process.env.ELASTICSEARCH_ENDPOINT,
  cloudId: process.env.ELASTICSEARCH_CLOUD_ID,
  username: process.env.ELASTICSEARCH_USER,
  password: process.env.ELASTICSEARCH_PASSWORD,
  apiKey: process.env.ELASTICSEARCH_API_KEY,
  model: process.env.ELASTICSEARCH_MODEL || '.elser_model_2',
  index: process.env.ELASTICSEARCH_INDEX || 'code-chunks',
  logging: process.env.ELASTICSEARCH_LOGGING === 'true',
};

export const indexingConfig = {
  batchSize: parseInt(process.env.BATCH_SIZE || '500', 10),
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '1000', 10),
  cpuCores: parseInt(process.env.CPU_CORES || `${Math.max(1, Math.floor(os.cpus().length / 2))}`, 10),
};

export const appConfig = {
  queueDir: process.env.QUEUE_DIR || '.queue',
  queueBaseDir: process.env.QUEUE_BASE_DIR || '.queues',
};


