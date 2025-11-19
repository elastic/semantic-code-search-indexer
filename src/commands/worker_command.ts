import { IndexerWorker } from '../utils/indexer_worker';
import { indexingConfig } from '../config';
import { createLogger } from '../utils/logger';
import { SqliteQueue } from '../utils/sqlite_queue';
import path from 'path';

export interface WorkerOptions {
  queueDir: string;
  elasticsearchIndex?: string;
  repoName?: string;
  branch?: string;
  token?: string;
}

export async function worker(concurrency: number = 1, watch: boolean = false, options: WorkerOptions) {
  const repoInfo =
    options?.repoName && options?.branch ? { name: options.repoName, branch: options.branch } : undefined;
  const logger = createLogger(repoInfo);

  logger.info('Starting indexer worker process', { concurrency, ...options });

  const queuePath = path.join(options.queueDir, 'queue.db');
  const queue = new SqliteQueue({
    dbPath: queuePath,
    repoName: options?.repoName,
    branch: options?.branch,
  });
  await queue.initialize();

  const indexerWorker = new IndexerWorker({
    queue,
    batchSize: indexingConfig.batchSize,
    concurrency,
    watch,
    logger,
    elasticsearchIndex: options?.elasticsearchIndex,
    repoInfo,
  });

  await indexerWorker.start();
}
