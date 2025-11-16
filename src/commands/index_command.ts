import { Command, Option } from 'commander';
import { index as indexRepo } from './full_index_producer';
import { incrementalIndex } from './incremental_index_command';
import { worker } from './worker_command';
import { appConfig } from '../config';
import { logger } from '../utils/logger';
import { shutdown } from '../utils/otel_provider';
import { cloneOrPullRepo, pullRepo } from '../utils/git_helper';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';

interface RepoConfig {
  repoPath: string;
  repoName: string;
  indexName: string;
  token?: string;
  branch?: string;
}

/**
 * Parse a repo argument into a RepoConfig
 * Supports:
 * - URLs: https://github.com/elastic/kibana.git[:index]
 * - Repo names: kibana[:index]
 * - Full paths: /path/to/repo[:index]
 */
export function parseRepoArg(arg: string, globalToken?: string, globalBranch?: string): RepoConfig {
  // Split on the last ':' to handle URLs with '://' and SSH URLs with ':'
  let repoSpec: string;
  let indexName: string | undefined;

  // Check if it's a Windows absolute path (e.g., C:\path or C:/path)
  const isWindowsPath = /^[A-Za-z]:[/\\]/.test(arg);

  // Check if it's a URL or SSH format first
  if (arg.includes('://')) {
    // HTTPS/HTTP URLs - look for index after the last meaningful ':'
    const lastColonIndex = arg.lastIndexOf(':');
    const potentialIndex = arg.substring(lastColonIndex + 1);

    // Check if what's after the last ':' looks like an index name (not a port)
    if (
      lastColonIndex > 0 &&
      !potentialIndex.includes('/') &&
      !potentialIndex.includes('.git') &&
      potentialIndex.length > 0 &&
      !(lastColonIndex < arg.indexOf('://') + 10) // Not the port in https://
    ) {
      repoSpec = arg.substring(0, lastColonIndex);
      indexName = potentialIndex;
    } else {
      repoSpec = arg;
    }
  } else if (arg.startsWith('git@')) {
    // SSH URLs (git@github.com:org/repo.git or git@github.com:org/repo.git:index)
    // Find the last ':' and check if it's an index separator
    const lastColonIndex = arg.lastIndexOf(':');
    const potentialIndex = arg.substring(lastColonIndex + 1);

    // If what's after the last ':' doesn't contain '/' and isn't a path component, it's an index
    if (
      lastColonIndex > 0 &&
      !potentialIndex.includes('/') &&
      !potentialIndex.includes('.git') &&
      potentialIndex.length > 0 &&
      lastColonIndex > arg.indexOf('@') + 1 // Make sure it's not the first ':' after git@
    ) {
      // Check if this is the SSH separator or an index separator
      const beforeColon = arg.substring(0, lastColonIndex);
      if (beforeColon.includes('/')) {
        // There's already a path, so this must be an index separator
        repoSpec = beforeColon;
        indexName = potentialIndex;
      } else {
        // No path yet, this is the SSH separator
        repoSpec = arg;
      }
    } else {
      repoSpec = arg;
    }
  } else if (isWindowsPath) {
    // Windows path - check for index name after the path
    // Look for ':' that's not the drive letter separator
    const driveLetterEnd = arg.indexOf(':') + 1;
    const remainingPath = arg.substring(driveLetterEnd);
    const indexSeparatorPos = remainingPath.indexOf(':');

    if (indexSeparatorPos > 0) {
      // Found an index separator after the drive letter
      repoSpec = arg.substring(0, driveLetterEnd + indexSeparatorPos);
      indexName = remainingPath.substring(indexSeparatorPos + 1);
    } else {
      repoSpec = arg;
    }
  } else {
    // For non-URLs and non-Windows paths, split normally on ':'
    const parts = arg.split(':');
    repoSpec = parts[0];
    indexName = parts[1];
  }

  let repoPath: string;
  let repoName: string;

  // Check if it's a URL
  if (repoSpec.includes('://') || repoSpec.includes('github.com') || repoSpec.includes('.git')) {
    // Extract repo name from URL
    const urlMatch = repoSpec.match(/\/([^\/]+?)(\.git)?$/);
    repoName = urlMatch ? urlMatch[1] : path.basename(repoSpec, '.git');
    repoPath = path.join(process.cwd(), '.repos', repoName);
  } else if (isWindowsPath || repoSpec.includes('/') || repoSpec.includes('\\')) {
    // Full path provided (Windows or Unix)
    repoPath = path.resolve(repoSpec);
    repoName = path.basename(repoPath);
  } else {
    // Just a repo name - look in .repos/
    repoName = repoSpec;
    repoPath = path.join(process.cwd(), '.repos', repoName);
  }

  return {
    repoPath,
    repoName,
    indexName: indexName || repoName,
    token: globalToken,
    branch: globalBranch,
  };
}

/**
 * Clone a repository if it doesn't exist
 * Note: This is a thin wrapper around the shared git_helper utility
 */
export async function ensureRepoCloned(repoUrl: string, repoPath: string, token?: string): Promise<void> {
  if (fs.existsSync(repoPath)) {
    logger.info(`Repository already exists at ${repoPath}`);
    return;
  }

  await cloneOrPullRepo(repoUrl, repoPath, token);
}

/**
 * Check if queue has pending items
 */
export function hasQueueItems(repoName: string): boolean {
  const queueDir = path.join(appConfig.queueBaseDir, repoName);
  const queueDbPath = path.join(queueDir, 'queue.db');

  if (!fs.existsSync(queueDbPath)) {
    return false;
  }

  try {
    const db = new Database(queueDbPath, { readonly: true });
    const result = db
      .prepare("SELECT COUNT(*) as count FROM queue WHERE status IN ('pending', 'processing')")
      .get() as { count: number };
    db.close();
    return result.count > 0;
  } catch (error) {
    logger.warn(`Could not check queue status: ${error}`);
    return false;
  }
}

/**
 * Main unified index function
 */
async function indexRepos(
  repoArgs: string[],
  options: {
    clean?: boolean;
    pull?: boolean;
    watch?: boolean;
    concurrency?: string;
    token?: string;
    branch?: string;
  }
) {
  logger.info('Starting index command...');

  // Support REPOSITORIES_TO_INDEX env var for backward compatibility
  // Format: "repo1 repo2 repo3" or "repo1:index1 repo2:index2"
  if ((!repoArgs || repoArgs.length === 0) && process.env.REPOSITORIES_TO_INDEX) {
    const envRepos = process.env.REPOSITORIES_TO_INDEX.trim().split(/\s+/);
    logger.info(`Using repositories from REPOSITORIES_TO_INDEX env var: ${envRepos.join(', ')}`);
    repoArgs = envRepos;
  }

  if (!repoArgs || repoArgs.length === 0) {
    logger.error('No repository configurations provided. Exiting.');
    logger.error('Provide repositories as arguments or set REPOSITORIES_TO_INDEX environment variable.');
    process.exit(1);
  }

  if (options.watch && repoArgs.length > 1) {
    logger.warn(
      `Watch mode enabled with ${repoArgs.length} repositories. Only the first repository (${repoArgs[0]}) will be watched.`
    );
  }

  const concurrency = parseInt(options.concurrency || '1', 10);

  for (let i = 0; i < repoArgs.length; i++) {
    const repoArg = repoArgs[i];
    const config = parseRepoArg(repoArg, options.token, options.branch);
    const isFirstRepo = i === 0;
    const shouldWatch = options.watch && isFirstRepo;

    logger.info(`--- Processing repository: ${config.repoName} ---`);

    // Step 1: Clone if it's a URL and doesn't exist
    if (repoArg.includes('://') || repoArg.startsWith('git@')) {
      // Extract the URL part (before any :index suffix)
      let repoUrl = repoArg;

      // Remove :index suffix if present (but not for SSH URLs)
      if (repoArg.includes('://')) {
        const lastColonIndex = repoArg.lastIndexOf(':');
        const potentialIndex = repoArg.substring(lastColonIndex + 1);

        if (
          lastColonIndex > 0 &&
          !potentialIndex.includes('/') &&
          !potentialIndex.includes('.git') &&
          potentialIndex.length > 0 &&
          !(lastColonIndex < repoArg.indexOf('://') + 10)
        ) {
          repoUrl = repoArg.substring(0, lastColonIndex);
        }
      }

      await ensureRepoCloned(repoUrl, config.repoPath, config.token);
    }

    // Step 2: Verify repo exists
    if (!fs.existsSync(config.repoPath)) {
      logger.error(`Repository not found at ${config.repoPath}. Skipping.`);
      continue;
    }

    // Step 3: Pull if requested
    if (options.pull) {
      await pullRepo(config.repoPath, config.branch);
    }

    // Step 4: Determine git branch
    let gitBranch = config.branch;
    if (!gitBranch) {
      try {
        gitBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: config.repoPath,
        })
          .toString()
          .trim();
      } catch {
        logger.warn(`Could not extract git branch for ${config.repoName}. Using 'unknown'.`);
        gitBranch = 'unknown';
      }
    }

    const queueDir = path.join(appConfig.queueBaseDir, config.repoName);

    const indexOptions = {
      queueDir,
      elasticsearchIndex: config.indexName,
      token: config.token,
      repoName: config.repoName,
      branch: gitBranch,
    };

    try {
      // Step 5: Decide what to do based on flags and queue state
      if (options.clean) {
        // Full clean reindex
        logger.info(`Running clean reindex for ${config.repoName}...`);
        await indexRepo(config.repoPath, true, indexOptions);
      } else if (hasQueueItems(config.repoName)) {
        // Queue has items - check if enqueue was completed
        const queueDbPath = path.join(appConfig.queueBaseDir, config.repoName, 'queue.db');
        const { SqliteQueue } = await import('../utils/sqlite_queue');
        const queue = new SqliteQueue({
          dbPath: queueDbPath,
          repoName: config.repoName,
          branch: gitBranch,
        });
        await queue.initialize();

        if (!queue.isEnqueueCompleted()) {
          // Queue has items but enqueue was not completed - interrupted during enqueue
          // Clear and re-enqueue (enqueue is fast, no need for deduplication complexity)
          logger.info(`Queue has pending items but enqueue was not completed for ${config.repoName}.`);
          logger.info(`Clearing partial queue and re-enqueueing from scratch...`);
          await queue.clear();
          await indexRepo(config.repoPath, false, indexOptions);
        } else {
          // Normal resume - enqueue completed, just process the queue
          logger.info(`Queue has pending items for ${config.repoName}. Resuming...`);
        }
      } else {
        // Queue is empty - try incremental, fall back to full index if no previous commit
        const { getLastIndexedCommit } = await import('../utils/elasticsearch');
        const lastCommitHash = await getLastIndexedCommit(gitBranch, config.indexName);

        if (lastCommitHash) {
          // Previous index exists - do incremental
          logger.info(`Running incremental index for ${config.repoName}...`);
          await incrementalIndex(config.repoPath, indexOptions);
        } else {
          // No previous index - do full index
          logger.info(`No previous index found for ${config.repoName}. Running full index...`);
          await indexRepo(config.repoPath, false, indexOptions);
        }
      }

      // Step 6: Run worker
      if (shouldWatch) {
        logger.info(`Running worker for ${config.repoName} with concurrency ${concurrency} (watch mode enabled)...`);
        logger.info(`Watching queue for ${config.repoName}. Worker will continue running...`);
      } else {
        logger.info(`Running worker for ${config.repoName} with concurrency ${concurrency}...`);
      }
      await worker(concurrency, shouldWatch, indexOptions);

      // Step 7: Update last indexed commit after successful worker completion
      if (!shouldWatch) {
        try {
          const commitHash = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: config.repoPath,
          })
            .toString()
            .trim();

          const { updateLastIndexedCommit } = await import('../utils/elasticsearch');
          await updateLastIndexedCommit(gitBranch, commitHash, config.indexName);
          logger.info(`Updated last indexed commit to ${commitHash} for branch ${gitBranch}`);
        } catch (error) {
          logger.warn(`Failed to update last indexed commit: ${error instanceof Error ? error.message : error}`);
        }
      }

      logger.info(`--- Finished processing for: ${config.repoName} ---`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(`Failed to process repository ${config.repoName}`, {
        error: errorMessage,
        stack: errorStack,
      });
      console.error('Full error details:', error);
    }
  }

  logger.info('All repositories processed.');

  // Flush OpenTelemetry logs before exiting
  await shutdown();
}

export const indexCommand = new Command('index')
  .description('Index one or more repositories')
  .argument(
    '[repos...]',
    'Repository names, paths, or URLs (format: repo[:index]). Can also use REPOSITORIES_TO_INDEX env var.'
  )
  .addOption(new Option('--clean', 'Delete index and reindex all files (full rebuild)'))
  .addOption(new Option('--pull', 'Git pull before indexing'))
  .addOption(new Option('--watch', 'Keep worker running after processing queue'))
  .addOption(new Option('--concurrency <number>', 'Number of parallel workers').default('1'))
  .addOption(new Option('--token <token>', 'GitHub token for private repositories'))
  .addOption(new Option('--branch <branch>', 'Branch name for logging/metadata (default: auto-detect)'))
  .action(async (repos, options) => {
    try {
      await indexRepos(repos, options);
    } catch (error) {
      logger.error('Fatal error in index command', { error });
      await shutdown();
      throw error;
    }
  });
