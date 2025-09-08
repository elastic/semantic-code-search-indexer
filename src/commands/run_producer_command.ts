import { Command } from 'commander';
import { incrementalIndex } from './incremental_index_command';
import { worker } from './worker_command';
import { appConfig } from '../config';
import { logger } from '../utils/logger';
import path from 'path';

async function runProducer() {
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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      logger.error(`Failed to process repository ${repoName}`, { error: errorMessage });
    }
  }

  logger.info('All repositories processed. Producer service finished.');
}

export const runProducerCommand = new Command('run-producer')
  .description('Run the multi-repository producer service')
  .action(runProducer);
