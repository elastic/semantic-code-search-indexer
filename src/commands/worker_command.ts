import { Command, Option } from 'commander';
import { IndexerWorker } from '../utils/indexer_worker';
import { appConfig, indexingConfig } from '../config';
import { logger } from '../utils/logger';
import { SqliteQueue } from '../utils/sqlite_queue';
import path from 'path';

interface WorkerOptions {
  queueDir: string;
  elasticsearchIndex: string;
}

export async function worker(concurrency: number = 1, watch: boolean = false, options?: WorkerOptions) {
  logger.info('Starting indexer worker process', { concurrency, ...options });

  const queuePath = options ? path.join(options.queueDir, 'queue.db') : path.join(appConfig.queueDir, 'queue.db');
  const queue = new SqliteQueue(queuePath);
  await queue.initialize();

  const indexerWorker = new IndexerWorker(queue, indexingConfig.batchSize, concurrency, watch, options?.elasticsearchIndex);

  await indexerWorker.start();
}

export const workerCommand = new Command('worker')
  .description('Start a single indexer worker for development')
  .addOption(new Option('--concurrency <number>', 'Number of parallel workers to run').default(1).argParser(parseInt))
  .addOption(new Option('--watch', 'Run the worker in watch mode'))
  .action(async (options) => {
    await worker(options.concurrency, options.watch);
  });