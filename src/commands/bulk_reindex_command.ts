import { Command } from 'commander';
import { index } from './index_command';
import { worker } from './worker_command';
import { appConfig } from '../config';
import { logger } from '../utils/logger';
import path from 'path';
import { execSync } from 'child_process';

async function startReindexProducer(repoConfigs: string[], concurrency: number) {
  logger.info('Starting multi-repository reindex producer...');

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
      gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath })
        .toString()
        .trim();
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
      logger.info(`Running clean reindex for ${repoName}...`);
      await index(repoPath, true, options); // clean = true

      logger.info(`Running worker for ${repoName} with concurrency ${concurrency}...`);
      await worker(concurrency, false, options);

      logger.info(`--- Finished processing for: ${repoName} ---`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      logger.error(`Failed to process repository ${repoName}`, { error: errorMessage });
    }
  }

  logger.info('All repositories processed. Reindex producer finished.');
}

export const bulkReindexCommand = new Command('bulk:reindex')
  .description('Run clean reindex for multiple repositories.')
  .argument('<repo-configs...>', 'Space-separated list of repository configurations in "path:index" format.')
  .option('--concurrency <number>', 'Number of parallel workers to run per repository', '1')
  .action(async (repoConfigs, options) => {
    const concurrency = parseInt(options.concurrency, 10);
    await startReindexProducer(repoConfigs, concurrency);
  });
