import { Command, Option } from 'commander';
import { IndexerWorker } from '../utils/indexer_worker';
import { appConfig, indexingConfig } from '../config';
import { logger } from '../utils/logger';
import { SqliteQueue } from '../utils/sqlite_queue';

export async function worker(concurrency: number = 1, watch: boolean = false) {
  logger.info('Starting indexer worker process', { concurrency });

  const queue = new SqliteQueue(appConfig.queueDir);
  await queue.initialize();

  const indexerWorker = new IndexerWorker(queue, indexingConfig.batchSize, concurrency, watch);

  await indexerWorker.start();
}

export const workerCommand = new Command('worker')
  .description('Start a single indexer worker for development')
  .addOption(new Option('--concurrency <number>', 'Number of parallel workers to run').default(1).argParser(parseInt))
  .addOption(new Option('--watch', 'Run the worker in watch mode'))
  .action(async (options) => {
    await worker(options.concurrency, options.watch);
  });