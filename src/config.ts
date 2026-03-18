import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

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

/**
 * Parses an environment variable into a non-negative integer.
 *
 * @param envVarName The name of the environment variable.
 * @param fallback The default value if the environment variable is not set.
 * @returns The parsed non-negative integer.
 */
function parseEnvNonNegativeInt(envVarName: string, fallback: number): number {
  const value = process.env[envVarName];
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid configuration: ${envVarName} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

/**
 * Parses an environment variable into a positive integer.
 *
 * @param envVarName The name of the environment variable.
 * @param fallback The default value if the environment variable is not set.
 * @returns The parsed positive integer.
 */
function parseEnvPositiveInt(envVarName: string, fallback: number): number {
  const value = process.env[envVarName];
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid configuration: ${envVarName} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

/**
 * Parses an environment variable into a boolean.
 *
 * @param envVarName The name of the environment variable.
 * @param fallback The default value if the environment variable is not set.
 * @returns The parsed boolean.
 */
function parseEnvBoolean(envVarName: string, fallback: boolean): boolean {
  const value = process.env[envVarName];
  if (value === undefined || value.trim() === '') return fallback;
  const lower = value.trim().toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  throw new Error(`Invalid configuration: ${envVarName} must be a boolean (true/false/1/0), got "${value}"`);
}

// Don't override existing environment variables (important for tests).
// In test mode, load .env.test instead of .env. If the file doesn't exist,
// dotenv silently skips it (quiet: true).
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: path.join(projectRoot, envFile), override: false, quiet: true });

export const elasticsearchConfig = {
  get endpoint() {
    return process.env.ELASTICSEARCH_ENDPOINT;
  },
  get cloudId() {
    return process.env.ELASTICSEARCH_CLOUD_ID || undefined;
  },
  get username() {
    return process.env.ELASTICSEARCH_USERNAME;
  },
  get password() {
    return process.env.ELASTICSEARCH_PASSWORD;
  },
  get apiKey() {
    return process.env.ELASTICSEARCH_API_KEY || undefined;
  },
  get inferenceId() {
    return process.env.SCSI_ELASTICSEARCH_INFERENCE_ID || undefined;
  },
  get requestTimeout() {
    return parseEnvPositiveInt('SCSI_ELASTICSEARCH_REQUEST_TIMEOUT', 90000);
  },
  get disableSemanticText() {
    return parseEnvBoolean('SCSI_DISABLE_SEMANTIC_TEXT', false);
  },
};

export const otelConfig = {
  get enabled() {
    return parseEnvBoolean('SCSI_OTEL_LOGGING_ENABLED', false);
  },
  get serviceName() {
    return process.env.OTEL_SERVICE_NAME || 'semantic-code-search-indexer';
  },
  get endpoint() {
    return (
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'
    );
  },
  get headers() {
    return process.env.OTEL_EXPORTER_OTLP_HEADERS || '';
  },
  get metricsEnabled() {
    const explicit = process.env.SCSI_OTEL_METRICS_ENABLED;
    if (explicit !== undefined && explicit.trim() !== '') {
      return parseEnvBoolean('SCSI_OTEL_METRICS_ENABLED', false);
    }
    return this.enabled; // Fallback to logging enabled status
  },
  get metricsEndpoint() {
    return (
      process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      'http://localhost:4318'
    );
  },
  get metricExportIntervalMs() {
    return parseEnvPositiveInt('SCSI_OTEL_METRIC_EXPORT_INTERVAL_MILLIS', 60000);
  },
  get logLevel() {
    return process.env.OTEL_LOG_LEVEL;
  },
  get resourceAttributes() {
    return process.env.OTEL_RESOURCE_ATTRIBUTES;
  },
};

export const indexingConfig = {
  get maxChunkSizeBytes() {
    return parseEnvPositiveInt('SCSI_MAX_CHUNK_SIZE_BYTES', 1000000);
  },
  set maxChunkSizeBytes(v: number) {
    process.env.SCSI_MAX_CHUNK_SIZE_BYTES = v.toString();
  },

  get enableDenseVectors() {
    return parseEnvBoolean('SCSI_ENABLE_DENSE_VECTORS', false);
  },
  set enableDenseVectors(v: boolean) {
    process.env.SCSI_ENABLE_DENSE_VECTORS = v ? 'true' : 'false';
  },

  get defaultChunkLines() {
    return parseEnvPositiveInt('SCSI_DEFAULT_CHUNK_LINES', 15);
  },
  set defaultChunkLines(v: number) {
    process.env.SCSI_DEFAULT_CHUNK_LINES = v.toString();
  },

  get chunkOverlapLines() {
    return parseEnvNonNegativeInt('SCSI_CHUNK_OVERLAP_LINES', 3);
  },
  set chunkOverlapLines(v: number) {
    process.env.SCSI_CHUNK_OVERLAP_LINES = v.toString();
  },

  get markdownChunkDelimiter() {
    return process.env.SCSI_MARKDOWN_CHUNK_DELIMITER || '\\n\\s*\\n';
  },
  set markdownChunkDelimiter(v: string) {
    process.env.SCSI_MARKDOWN_CHUNK_DELIMITER = v;
  },

  get testThrowOnFilePath() {
    return process.env.SCSI_TEST_INDEXING_THROW_ON_FILEPATH;
  },
  set testThrowOnFilePath(v: string | undefined) {
    if (v === undefined) delete process.env.SCSI_TEST_INDEXING_THROW_ON_FILEPATH;
    else process.env.SCSI_TEST_INDEXING_THROW_ON_FILEPATH = v;
  },

  get testDelayMs() {
    return parseEnvNonNegativeInt('SCSI_TEST_INDEXING_DELAY_MS', 0);
  },
  set testDelayMs(v: number) {
    process.env.SCSI_TEST_INDEXING_DELAY_MS = v.toString();
  },
};

export const appConfig = {
  get queueBaseDir() {
    return path.resolve(projectRoot, process.env.SCSI_QUEUE_BASE_DIR || '.queues');
  },
  set queueBaseDir(v: string) {
    process.env.SCSI_QUEUE_BASE_DIR = v;
  },

  get githubToken() {
    return process.env.GITHUB_TOKEN;
  },
  set githubToken(v: string | undefined) {
    if (v === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = v;
  },

  get languages() {
    return process.env.SCSI_LANGUAGES;
  },
  set languages(v: string | undefined) {
    if (v === undefined) delete process.env.SCSI_LANGUAGES;
    else process.env.SCSI_LANGUAGES = v;
  },

  get nodeEnv() {
    return process.env.NODE_ENV;
  },
  set nodeEnv(v: string | undefined) {
    if (v === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = v;
  },

  get forceLogging() {
    return parseEnvBoolean('SCSI_FORCE_LOGGING', false);
  },
  set forceLogging(v: boolean) {
    process.env.SCSI_FORCE_LOGGING = v ? 'true' : 'false';
  },
};
