import { Command, Option } from 'commander';
import path from 'path';
import { IndexerWorker } from '../utils/indexer_worker';
import { appConfig, indexingConfig } from '../config';
import { logger } from '../utils/logger';
import { SqliteQueue } from '../utils/sqlite_queue';

async function multiWorker(
  concurrency: number = 1,
  watch: boolean = false,
  repoName: string
) {
  if (!repoName) {
    logger.error('Multi-worker started without a repository name (--repo-name). Exiting.');
    process.exit(1);
  }

  logger.info(`Starting multi-worker for repository: ${repoName}`, { concurrency });

  const queuePath = path.join(appConfig.queueBaseDir, repoName);
  const queue = new SqliteQueue(queuePath);
  await queue.initialize();

  const repoConfig = process.env.REPOSITORIES_TO_INDEX
    ?.split(' ')
    .find(conf => conf.includes(`/${repoName}:`));
  
  if (!repoConfig) {
      logger.error(`Could not find configuration for repository in REPOSITORIES_TO_INDEX: ${repoName}`);
      process.exit(1);
  }
  const esIndex = repoConfig.split(':')[1];
  
  process.env.ELASTICSEARCH_INDEX = esIndex; 
  logger.info(`Worker for ${repoName} will use Elasticsearch index: ${esIndex}`);

  const indexerWorker = new IndexerWorker(queue, indexingConfig.batchSize, concurrency, watch);
  await indexerWorker.start();
}

export const multiWorkerCommand = new Command('multi-index-worker')
  .description('Start a dedicated worker for a specific repository')
  .addOption(new Option('--concurrency <number>', 'Number of parallel workers to run').default(1).argParser(parseInt))
  .addOption(new Option('--watch', 'Run the worker in watch mode'))
  .addOption(new Option('--repo-name <repoName>', 'The name of the repository to process').makeOptionMandatory())
  .action(async (options) => {
    await multiWorker(options.concurrency, options.watch, options.repoName);
  });