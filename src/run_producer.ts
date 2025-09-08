import './config'; // Must be the first import
import { incrementalIndex } from './commands/incremental_index_command';
import { worker } from './commands/worker_command';
import { appConfig } from './config';
import { logger } from './utils/logger';
import path from 'path';

async function main() {
  logger.info('Starting multi-repository producer service...');

  const reposToIndex = process.env.REPOSITORIES_TO_INDEX;
  if (!reposToIndex) {
    logger.error('REPOSITORIES_TO_INDEX is not set. Exiting.');
    process.exit(1);
  }

  const repoConfigs = reposToIndex.split(' ').filter(Boolean);

  for (const repoConfig of repoConfigs) {
    const [repoPath, esIndex] = repoConfig.split(':');
    const repoName = path.basename(repoPath);
    const queuePath = path.join(appConfig.queueBaseDir, repoName);

    logger.info(`--- Processing repository: ${repoName} ---`);

    // Set environment variables for the upcoming commands
    process.env.QUEUE_DIR = queuePath;
    process.env.ELASTICSEARCH_INDEX = esIndex;

    try {
      logger.info(`Running incremental indexer for ${repoName}...`);
      await incrementalIndex(repoPath);

      logger.info(`Running worker for ${repoName}...`);
      await worker();

      logger.info(`--- Finished processing for: ${repoName} ---`);
    } catch (error) {
      logger.error(`Failed to process repository ${repoName}`, { error });
      // Depending on desired behavior, you might want to continue or exit.
      // For now, we will log the error and continue to the next repo.
    }
  }

  logger.info('All repositories processed. Producer service finished.');
}

main().catch(error => {
  logger.error('An unexpected error occurred in the producer service', { error });
  process.exit(1);
});
