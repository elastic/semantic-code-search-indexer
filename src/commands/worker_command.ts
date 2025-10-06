import { Command, Option } from 'commander';
import { IndexerWorker } from '../utils/indexer_worker';
import { appConfig, indexingConfig } from '../config';
import { createLogger } from '../utils/logger';
import { SqliteQueue } from '../utils/sqlite_queue';
import path from 'path';

interface WorkerOptions {
  queueDir: string;
  elasticsearchIndex: string;
  repoName?: string;
  branch?: string;
}

export async function worker(concurrency: number = 1, watch: boolean = false, options?: WorkerOptions) {
  const logger = createLogger(options?.repoName && options?.branch ? { name: options.repoName, branch: options.branch } : undefined);
  logger.info('Starting indexer worker process', { concurrency, ...options });

  const queuePath = options?.queueDir ? path.join(options.queueDir, 'queue.db') : path.join(appConfig.queueDir, 'queue.db');
  const queue = new SqliteQueue(queuePath);
  await queue.initialize();

  const indexerWorker = new IndexerWorker(queue, indexingConfig.batchSize, concurrency, watch, logger, options?.elasticsearchIndex);

  await indexerWorker.start();
}

export const workerCommand = new Command('worker')
  .description('Start a single indexer worker')
  .addOption(new Option('--concurrency <number>', 'Number of parallel workers to run').default(1))
  .addOption(new Option('--watch', 'Run the worker in watch mode'))
  .addOption(new Option('--repoName <name>', 'Name of the repository being indexed'))
  .addOption(new Option('--branch <branch>', 'Branch of the repository being indexed'))
  .action(async (options) => {
    const concurrency = parseInt(options.concurrency, 10);
    await worker(concurrency, options.watch, options);
  });
