// src/utils/metrics.ts
import { getMeterProvider } from './otel_provider';
import { Meter, Counter, Histogram, ObservableGauge } from '@opentelemetry/api';
import { ATTR_REPO_NAME, ATTR_REPO_BRANCH } from './constants';

interface RepoInfo {
  name: string;
  branch: string;
}

/**
 * Metric instruments for parser operations.
 */
export interface ParserMetrics {
  filesProcessed: Counter;
  filesFailed: Counter;
  chunksCreated: Counter;
  chunksSkipped: Counter;
  chunkSize: Histogram;
}

/**
 * Metric instruments for queue operations.
 */
export interface QueueMetrics {
  documentsEnqueued: Counter;
  documentsDequeued: Counter;
  documentsCommitted: Counter;
  documentsRequeued: Counter;
  documentsFailed: Counter;
  documentsDeleted: Counter;
  queueSizePending: ObservableGauge;
  queueSizeProcessing: ObservableGauge;
  queueSizeFailed: ObservableGauge;
}

/**
 * Metric instruments for indexer operations.
 */
export interface IndexerMetrics {
  batchProcessed: Counter;
  batchFailed: Counter;
  batchDuration: Histogram;
  batchSize: Histogram;
}

/**
 * Collection of all metric instruments and the meter instance.
 */
export interface Metrics {
  meter: Meter | null;
  parser: ParserMetrics | null;
  queue: QueueMetrics | null;
  indexer: IndexerMetrics | null;
  repoInfo?: RepoInfo;
}

/**
 * Creates a metrics instance with all metric instruments.
 *
 * If OpenTelemetry metrics are disabled, returns a no-op metrics instance
 * that safely ignores all metric recording calls.
 *
 * @param repoInfo - Optional repository context to attach to all metrics
 * @returns Metrics instance with all metric instruments
 *
 * @example
 * // Create metrics with repository context
 * const metrics = createMetrics({ name: 'kibana', branch: 'main' });
 * metrics.parser?.filesProcessed.add(1, { language: 'typescript', status: 'success' });
 *
 * @example
 * // Create metrics without repository context
 * const metrics = createMetrics();
 * metrics.indexer?.batchProcessed.add(1);
 */
export function createMetrics(repoInfo?: RepoInfo): Metrics {
  const meterProvider = getMeterProvider();

  if (!meterProvider) {
    return {
      meter: null,
      parser: null,
      queue: null,
      indexer: null,
      repoInfo, // Store repoInfo even when metrics are disabled
    };
  }

  const meter = meterProvider.getMeter('semantic-code-search-indexer');

  // Parser metrics
  const parserMetrics: ParserMetrics = {
    filesProcessed: meter.createCounter('parser.files.processed', {
      description: 'Total number of files processed by the parser',
      unit: 'files',
    }),
    filesFailed: meter.createCounter('parser.files.failed', {
      description: 'Total number of files that failed to parse',
      unit: 'files',
    }),
    chunksCreated: meter.createCounter('parser.chunks.created', {
      description: 'Total number of code chunks created',
      unit: 'chunks',
    }),
    chunksSkipped: meter.createCounter('parser.chunks.skipped', {
      description: 'Total number of chunks skipped due to size exceeding maxChunkSizeBytes',
      unit: 'chunks',
    }),
    chunkSize: meter.createHistogram('parser.chunks.size', {
      description: 'Distribution of chunk sizes in bytes',
      unit: 'bytes',
    }),
  };

  // Queue metrics
  const queueMetrics: QueueMetrics = {
    documentsEnqueued: meter.createCounter('queue.documents.enqueued', {
      description: 'Total number of documents added to queue',
      unit: 'documents',
    }),
    documentsDequeued: meter.createCounter('queue.documents.dequeued', {
      description: 'Total number of documents removed from queue',
      unit: 'documents',
    }),
    documentsCommitted: meter.createCounter('queue.documents.committed', {
      description: 'Total number of successfully indexed documents',
      unit: 'documents',
    }),
    documentsRequeued: meter.createCounter('queue.documents.requeued', {
      description: 'Total number of documents requeued after failure',
      unit: 'documents',
    }),
    documentsFailed: meter.createCounter('queue.documents.failed', {
      description: 'Total number of documents marked as failed',
      unit: 'documents',
    }),
    documentsDeleted: meter.createCounter('queue.documents.deleted', {
      description: 'Total number of documents deleted from queue',
      unit: 'documents',
    }),
    queueSizePending: meter.createObservableGauge('queue.size.pending', {
      description: 'Current number of pending documents in queue',
      unit: 'documents',
    }),
    queueSizeProcessing: meter.createObservableGauge('queue.size.processing', {
      description: 'Current number of processing documents in queue',
      unit: 'documents',
    }),
    queueSizeFailed: meter.createObservableGauge('queue.size.failed', {
      description: 'Current number of failed documents in queue',
      unit: 'documents',
    }),
  };

  // Indexer metrics
  const indexerMetrics: IndexerMetrics = {
    batchProcessed: meter.createCounter('indexer.batch.processed', {
      description: 'Total number of successful batches processed',
      unit: 'batches',
    }),
    batchFailed: meter.createCounter('indexer.batch.failed', {
      description: 'Total number of failed batches',
      unit: 'batches',
    }),
    batchDuration: meter.createHistogram('indexer.batch.duration', {
      description: 'Batch processing time in milliseconds',
      unit: 'milliseconds',
    }),
    batchSize: meter.createHistogram('indexer.batch.size', {
      description: 'Distribution of batch sizes',
      unit: 'documents',
    }),
  };

  return {
    meter,
    parser: parserMetrics,
    queue: queueMetrics,
    indexer: indexerMetrics,
    repoInfo,
  };
}

/**
 * Helper function to create attributes for metrics recording.
 *
 * Merges repository context with additional attributes.
 *
 * @param metrics - Metrics instance
 * @param attributes - Additional attributes to include
 * @returns Combined attributes object
 */
export function createAttributes(
  metrics: Metrics,
  attributes: Record<string, string | number> = {}
): Record<string, string | number> {
  const result: Record<string, string | number> = { ...attributes };

  if (metrics.repoInfo) {
    result[ATTR_REPO_NAME] = metrics.repoInfo.name;
    result[ATTR_REPO_BRANCH] = metrics.repoInfo.branch;
  }

  return result;
}
