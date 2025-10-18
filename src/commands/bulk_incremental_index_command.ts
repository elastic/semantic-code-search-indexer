
import { Command } from 'commander';
import { incrementalIndex } from './incremental_index_command';
import { worker } from './worker_command';
import { appConfig } from '../config';
import { logger } from '../utils/logger';
import path from 'path';
import simpleGit from 'simple-git';

async function startProducer(repoConfigs: string[], concurrency: number) {
  logger.info('Starting multi-repository producer service...');

  if (!repoConfigs || repoConfigs.length === 0) {
    logger.error('No repository configurations provided. Exiting.');
    process.exit(1);
  }

  for (const repoConfig of repoConfigs) {
    const [repoPath, esIndex, token] = repoConfig.split(':');
    if (!repoPath || !esIndex) {
      logger.error(`Invalid repository configuration format: "${repoConfig}". Expected "path:index[:token]". Skipping.`);
      continue;
    }
    const repoName = path.basename(repoPath);
    const queueDir = path.join(appConfig.queueBaseDir, repoName);

    // Extract git branch from the repository path
    let gitBranch = 'unknown';
    try {
      const git = simpleGit(repoPath);
      gitBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    } catch {
      logger.warn(`Could not extract git branch for ${repoName}. Using 'unknown'.`);
    }

    logger.info(`--- Processing repository: ${repoName} ---`);

    const options = {
      queueDir,
      elasticsearchIndex: esIndex,
      token,
      repoName,
      branch: gitBranch,
    };

    try {
      logger.info(`Running incremental indexer for ${repoName}...`);
      await incrementalIndex(repoPath, options);

      logger.info(`Running worker for ${repoName} with concurrency ${concurrency}...`);
      await worker(concurrency, false, options);

      logger.info(`--- Finished processing for: ${repoName} ---`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      logger.error(`Failed to process repository ${repoName}`, { error: errorMessage });
    }
  }

  logger.info('All repositories processed. Producer service finished.');
}

export const bulkIncrementalIndexCommand = new Command('bulk:incremental-index')
  .description('Run the producer service to index multiple repositories.')
  .argument('<repo-configs...>', 'Space-separated list of repository configurations in "path:index" format.')
  .option('--concurrency <number>', 'Number of parallel workers to run per repository', '1')
  .action(async (repoConfigs, options) => {
    const concurrency = parseInt(options.concurrency, 10);
    await startProducer(repoConfigs, concurrency);
  });
