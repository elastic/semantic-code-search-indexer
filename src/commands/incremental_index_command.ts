import { Command } from 'commander';
import {
  getLastIndexedCommit,
  updateLastIndexedCommit,
  deleteDocumentsByFilePath,
  setupElser,
} from '../utils/elasticsearch';
import { SUPPORTED_FILE_EXTENSIONS } from '../utils/constants';
import { indexingConfig, appConfig } from '../config';
import path from 'path';
import { Worker } from 'worker_threads';
import PQueue from 'p-queue';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';
import { IQueue } from '../utils/queue';
import { SqliteQueue } from '../utils/sqlite_queue';

async function getQueue(): Promise<IQueue> {
  const queue = new SqliteQueue(appConfig.queueDir);
  await queue.initialize();
  return queue;
}

async function incrementalIndex(directory: string) {
  logger.info('Starting incremental indexing process (Producer)', { directory });
  await setupElser();

  const gitCommand = process.env.GIT_PATH || 'git';

  const gitBranch = execSync(`${gitCommand} rev-parse --abbrev-ref HEAD`, { cwd: directory })
    .toString()
    .trim();
  const lastCommitHash = await getLastIndexedCommit(gitBranch);

  if (!lastCommitHash) {
    logger.warn('No previous commit hash found. Please run a full index first.', { gitBranch });
    return;
  }

  logger.info(`Last indexed commit hash: ${lastCommitHash}`, { gitBranch });

  logger.info('Pulling latest changes from remote', { gitBranch });
  try {
    execSync(`${gitCommand} pull origin ${gitBranch}`, { cwd: directory, stdio: 'pipe' });
    logger.info('Pull complete.');
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error('Failed to pull latest changes.', { error: error.message });
    } else {
      logger.error('Failed to pull latest changes with an unknown error.', { error });
    }
    return;
  }

  const gitRoot = execSync(`${gitCommand} rev-parse --show-toplevel`, { cwd: directory }).toString().trim();
  const changedFilesRaw = execSync(`${gitCommand} diff --name-status ${lastCommitHash} HEAD`, {
    cwd: directory,
  })
    .toString()
    .trim();

  const changedFiles = changedFilesRaw
    .split('\n')
    .filter(line => line)
    .map(line => {
      const [status, file] = line.split('\t');
      return { status, file };
    });

  const deletedFiles = changedFiles
    .filter(f => f.status === 'D')
    .map(f => f.file);

  const addedOrModifiedFiles = changedFiles
    .filter(
      f =>
        (f.status === 'A' || f.status === 'M') &&
        SUPPORTED_FILE_EXTENSIONS.includes(path.extname(f.file))
    )
    .map(f => f.file);

  logger.info(`Found ${changedFiles.length} changed files`, {
    addedOrModified: addedOrModifiedFiles.length,
    deleted: deletedFiles.length,
  });

  const filesToDelete = [...deletedFiles, ...addedOrModifiedFiles];
  for (const file of filesToDelete) {
    await deleteDocumentsByFilePath(file);
    logger.info('Deleted documents for file', { file });
  }

  if (addedOrModifiedFiles.length === 0) {
    logger.info('No new or modified files to process.');
  } else {
    logger.info('Processing and enqueueing added/modified files...');

    let successCount = 0;
    let failureCount = 0;
    const { cpuCores } = indexingConfig;
    const producerQueue = new PQueue({ concurrency: cpuCores });
    const workQueue: IQueue = await getQueue();

    const producerWorkerPath = path.join(process.cwd(), 'dist', 'utils', 'producer_worker.js');

    addedOrModifiedFiles.forEach(file => {
      producerQueue.add(() => new Promise<void>((resolve, reject) => {
        const worker = new Worker(producerWorkerPath);
        const absolutePath = path.resolve(gitRoot, file);
        worker.on('message', async (message) => {
          if (message.status === 'success') {
            successCount++;
            if (message.data.length > 0) {
              await workQueue.enqueue(message.data);
            }
          } else if (message.status === 'failure') {
            failureCount++;
            logger.warn('Failed to parse file', { file: message.filePath, error: message.error });
          }
          worker.terminate();
          resolve();
        });
        worker.on('error', err => {
          failureCount++;
          logger.error('Worker thread error', { file, error: err.message });
          worker.terminate();
          reject(err);
        });
        const relativePath = file;
        worker.postMessage({ filePath: absolutePath, gitBranch, relativePath });
      }));
    });

    await producerQueue.onIdle();

    logger.info('--- Incremental Producer Summary (Additions/Modifications) ---');
    logger.info(`Successfully processed: ${successCount} files`);
    logger.info(`Failed to parse:      ${failureCount} files`);
  }

  const newCommitHash = execSync(`${gitCommand} rev-parse HEAD`, { cwd: directory }).toString().trim();
  await updateLastIndexedCommit(gitBranch, newCommitHash);

  logger.info('---');
  logger.info(`New HEAD commit hash: ${newCommitHash}`);
  logger.info('---');
  logger.info('Incremental file parsing and enqueueing complete.');
}

export const incrementalIndexCommand = new Command('incremental-index')
  .description('Incrementally index a directory')
  .argument('[directory]', 'The directory to index', '.')
  .action(incrementalIndex);
