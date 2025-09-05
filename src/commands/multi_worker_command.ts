import path from 'path';
import { IndexerWorker } from '../utils/indexer_worker';
import { appConfig, indexingConfig } from '../config';
import { logger } from '../utils/logger';
import { SqliteQueue } from '../utils/sqlite_queue';

export async function multiWorker(
  concurrency: number = 1,
  watch: boolean = false,
  repoName: string
) {
  if (!repoName) {
    logger.error('Multi-worker started without a repository name (--repo-name). Exiting.');
    process.exit(1);
  }

  logger.info(`Starting multi-worker for repository: ${repoName}`, { concurrency });

  // Construct the dedicated queue path for this worker
  const queuePath = path.join(appConfig.queueBaseDir, repoName);
  const queue = new SqliteQueue(queuePath);
  await queue.initialize();

  // The worker also needs the correct ES index. It looks this up
  // from the main REPOSITORIES_TO_INDEX environment variable.
  const repoConfig = process.env.REPOSITORIES_TO_INDEX
    ?.split(' ')
    .find(conf => conf.includes(`/${repoName}:`));
  
  if (!repoConfig) {
      logger.error(`Could not find configuration for repository in REPOSITORIES_TO_INDEX: ${repoName}`);
      process.exit(1);
  }
  const esIndex = repoConfig.split(':')[1];
  
  // Set the index for the Elasticsearch client via environment variable
  process.env.ELASTICSEARCH_INDEX = esIndex; 
  logger.info(`Worker for ${repoName} will use Elasticsearch index: ${esIndex}`);

  const indexerWorker = new IndexerWorker(queue, indexingConfig.batchSize, concurrency, watch);
  await indexerWorker.start();
  await indexerWorker.onIdle();
  logger.info(`Worker for ${repoName} has finished processing.`);
}
