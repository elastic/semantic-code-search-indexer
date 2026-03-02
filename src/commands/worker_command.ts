import { IndexerWorker } from '../utils/indexer_worker';
import { createLogger } from '../utils/logger';
import { SqliteQueue } from '../utils/sqlite_queue';
import { createIndex, createLocationsIndex } from '../utils/elasticsearch';
import path from 'path';

export interface WorkerOptions {
  queueDir: string;
  elasticsearchIndex: string;
  batchSize?: number;
  repoName?: string;
  branch?: string;
}

export async function worker(concurrency: number = 1, watch: boolean = false, options: WorkerOptions) {
  const repoInfo =
    options?.repoName && options?.branch ? { name: options.repoName, branch: options.branch } : undefined;
  const logger = createLogger(repoInfo);
  const batchSize = options.batchSize ?? 100;

  logger.info('Starting indexer worker process', { concurrency, batchSize, ...options });

  // The worker can be run standalone (without going through the index command). Ensure the new
  // locations index exists so `indexCodeChunks` doesn't fail and leave rows stuck in processing.
  await createIndex(options.elasticsearchIndex);
  await createLocationsIndex(options.elasticsearchIndex);

  const queuePath = path.join(options.queueDir, 'queue.db');
  const queue = new SqliteQueue({
    dbPath: queuePath,
    repoName: options?.repoName,
    branch: options?.branch,
  });
  await queue.initialize();

  const indexerWorker = new IndexerWorker({
    queue,
    batchSize,
    concurrency,
    watch,
    logger,
    elasticsearchIndex: options.elasticsearchIndex,
    repoInfo,
  });

  await indexerWorker.start();
}
