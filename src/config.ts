import dotenv from 'dotenv';
import { env } from '@xenova/transformers';
import path from 'path';

dotenv.config();

export const elasticsearchConfig = {
  endpoint: process.env.ELASTICSEARCH_ENDPOINT || 'http://localhost:9200',
  username: process.env.ELASTICSEARCH_USER,
  password: process.env.ELASTICSEARCH_PASSWORD,
  apiKey: process.env.ELASTICSEARCH_API_KEY,
  model: process.env.ELASTICSEARCH_MODEL || '.elser_model_2',
  index: process.env.ELASTICSEARCH_INDEX || 'code-chunks',
};

// Configure Xenova/Transformers.js
env.allowRemoteModels = false;
env.localModelPath = path.resolve(process.cwd(), 'models');
