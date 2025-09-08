
import { Command } from 'commander';
import { incrementalIndex } from './incremental_index_command';
import { worker } from './worker_command';
import { appConfig } from '../config';
import { logger } from '../utils/logger';
import path from 'path';

async function startProducer(repoConfigs: string[]) {
  logger.info('Starting multi-repository producer service...');

  if (!repoConfigs || repoConfigs.length === 0) {
    logger.error('No repository configurations provided. Exiting.');
    process.exit(1);
  }

  for (const repoConfig of repoConfigs) {
    const [repoPath, esIndex] = repoConfig.split(':');
    if (!repoPath || !esIndex) {
      logger.error(`Invalid repository configuration format: "${repoConfig}". Expected "path:index". Skipping.`);
      continue;
    }
    const repoName = path.basename(repoPath);
    const queueDir = path.join(appConfig.queueBaseDir, repoName);

    logger.info(`--- Processing repository: ${repoName} ---`);

    const options = {
      queueDir,
      elasticsearchIndex: esIndex,
    };

    try {
      logger.info(`Running incremental indexer for ${repoName}...`);
      await incrementalIndex(repoPath, options);

      logger.info(`Running worker for ${repoName}...`);
      await worker(1, false, options);

      logger.info(`--- Finished processing for: ${repoName} ---`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      logger.error(`Failed to process repository ${repoName}`, { error: errorMessage });
    }
  }

  logger.info('All repositories processed. Producer service finished.');
}

export const startProducerCommand = new Command('start-producer')
  .description('Run the producer service to index multiple repositories.')
  .argument('<repo-configs...>', 'Space-separated list of repository configurations in "path:index" format.')
  .action(async (repoConfigs) => {
    await startProducer(repoConfigs);
  });
