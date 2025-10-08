import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';

dotenv.config({ quiet: true });

// Helper to find the project root by looking for package.json
function findProjectRoot(startPath: string): string {
    let currentPath = startPath;
    while (currentPath !== path.parse(currentPath).root) {
        if (fs.existsSync(path.join(currentPath, 'package.json'))) {
            return currentPath;
        }
        currentPath = path.dirname(currentPath);
    }
    return startPath; // Fallback
}

const projectRoot = findProjectRoot(__dirname);

export const elasticsearchConfig = {
  endpoint: process.env.ELASTICSEARCH_ENDPOINT || process.env.ELASTICSEARCH_HOST,
  cloudId: process.env.ELASTICSEARCH_CLOUD_ID,
  username: process.env.ELASTICSEARCH_USER || process.env.ELASTICSEARCH_USERNAME,
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
  maxChunkSizeBytes: parseInt(process.env.MAX_CHUNK_SIZE_BYTES || '1000000', 10),
  enableDenseVectors: process.env.ENABLE_DENSE_VECTORS === 'true',
};

export const appConfig = {
  queueDir: path.resolve(projectRoot, process.env.QUEUE_DIR || '.queue'),
  queueBaseDir: path.resolve(projectRoot, process.env.QUEUE_BASE_DIR || '.queues'),
  githubToken: process.env.GITHUB_TOKEN,
};
