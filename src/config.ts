import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Don't override existing environment variables (important for tests)
// In test mode, try to load .env.test (if it exists), otherwise skip .env to avoid interference
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: envFile, override: false, quiet: true });

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
  cloudId: process.env.ELASTICSEARCH_CLOUD_ID || undefined,
  username: process.env.ELASTICSEARCH_USER || process.env.ELASTICSEARCH_USERNAME,
  password: process.env.ELASTICSEARCH_PASSWORD,
  apiKey: process.env.ELASTICSEARCH_API_KEY || undefined,
  inferenceId: process.env.ELASTICSEARCH_INFERENCE_ID || process.env.ELASTICSEARCH_MODEL || '.elser-2-elasticsearch',
  index: process.env.ELASTICSEARCH_INDEX || 'code-chunks',
};

export const otelConfig = {
  enabled: process.env.OTEL_LOGGING_ENABLED === 'true',
  serviceName: process.env.OTEL_SERVICE_NAME || 'semantic-code-search-indexer',
  endpoint:
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
  headers: process.env.OTEL_EXPORTER_OTLP_HEADERS || '',
  metricsEnabled:
    process.env.OTEL_METRICS_ENABLED === 'true' ||
    (process.env.OTEL_METRICS_ENABLED === undefined && process.env.OTEL_LOGGING_ENABLED === 'true'),
  metricsEndpoint:
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    'http://localhost:4318',
  metricExportIntervalMs: parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL_MILLIS || '60000', 10),
};

export const indexingConfig = {
  batchSize: parseInt(process.env.BATCH_SIZE || '500', 10),
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '1000', 10),
  cpuCores: parseInt(process.env.CPU_CORES || `${Math.max(1, Math.floor(os.cpus().length / 2))}`, 10),
  maxChunkSizeBytes: parseInt(process.env.MAX_CHUNK_SIZE_BYTES || '1000000', 10),
  enableDenseVectors: process.env.ENABLE_DENSE_VECTORS === 'true',
  defaultChunkLines: parseInt(process.env.DEFAULT_CHUNK_LINES || '15', 10),
  chunkOverlapLines: parseInt(process.env.CHUNK_OVERLAP_LINES || '3', 10),
  markdownChunkDelimiter: process.env.MARKDOWN_CHUNK_DELIMITER || '\\n\\s*\\n',
  // Batch size for PIT pagination in deleteDocumentsByFilePaths. Larger values reduce round trips
  // but can increase per-request payload sizes.
  deleteDocumentsPageSize: parseInt(process.env.DELETE_DOCUMENTS_PAGE_SIZE || '500', 10),
  // Incremental parsing worker pool size. Reuses worker threads to reduce startup/teardown overhead.
  // This is clamped to CPU_CORES at runtime.
  producerWorkerPoolSize: parseInt(
    process.env.PRODUCER_WORKER_POOL_SIZE || `${Math.max(1, Math.floor(os.cpus().length / 2))}`,
    10
  ),
};

export const appConfig = {
  queueBaseDir: path.resolve(projectRoot, process.env.QUEUE_BASE_DIR || '.queues'),
  githubToken: process.env.GITHUB_TOKEN,
};
