import {
  indexCodeChunks,
  CodeChunk,
  getLastIndexedCommit,
  updateLastIndexedCommit,
  deleteDocumentsByFilePath,
  setupElser,
} from '../utils/elasticsearch';
import { SUPPORTED_FILE_EXTENSIONS } from '../utils/constants';
import { indexingConfig } from '../config';
import path from 'path';
import { Worker } from 'worker_threads';
import PQueue from 'p-queue';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';

/**
 * The main function for the `incremental-index` command.
 *
 * This function is responsible for orchestrating the incremental indexing
 * process. It finds the last indexed commit, pulls the latest changes from
 * the remote, and then processes the changed files.
 *
 * @param directory The directory to index.
 */
export async function incrementalIndex(directory: string) {
  logger.info('Starting incremental indexing process', { directory });
  await setupElser();

  const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: directory })
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
    execSync(`git pull origin ${gitBranch}`, { cwd: directory, stdio: 'pipe' });
    logger.info('Pull complete.');
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error('Failed to pull latest changes.', { error: error.message });
    } else {
      logger.error('Failed to pull latest changes with an unknown error.', { error });
    }
    return;
  }

  const gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory }).toString().trim();
  const changedFilesRaw = execSync(`git diff --name-status ${lastCommitHash} HEAD`, {
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

  // Process deletions and modifications
  const filesToDelete = [...deletedFiles, ...addedOrModifiedFiles];
  for (const file of filesToDelete) {
    await deleteDocumentsByFilePath(file);
    logger.info('Deleted documents for file', { file });
  }

  // Process additions/modifications
  if (addedOrModifiedFiles.length === 0) {
    logger.info('No new or modified files to index.');
  } else {
    logger.info('Processing and indexing added/modified files...');

    let successCount = 0;
    let failureCount = 0;
    const { batchSize, cpuCores } = indexingConfig;
    const producerQueue = new PQueue({ concurrency: cpuCores });
    const consumerQueue = new PQueue({ concurrency: 1 });

    let indexedChunks = 0;
    const chunkQueue: CodeChunk[] = [];

    const producerWorkerPath = path.join(process.cwd(), 'dist', 'utils', 'producer_worker.js');

    const scheduleConsumer = () => {
      while (chunkQueue.length >= batchSize) {
        const batch = chunkQueue.splice(0, batchSize);
        consumerQueue.add(async () => {
          indexedChunks += batch.length;
          logger.info('Indexing batch of chunks', {
            batchSize: batch.length,
            totalIndexedChunks: indexedChunks,
            filesParsed: successCount,
            totalFiles: addedOrModifiedFiles.length,
          });
          await indexCodeChunks(batch);
        });
      }
    };

    addedOrModifiedFiles.forEach(file => {
      producerQueue.add(() => new Promise<void>((resolve, reject) => {
        const worker = new Worker(producerWorkerPath);
        const absolutePath = path.resolve(gitRoot, file);
        worker.on('message', message => {
          if (message.status === 'success') {
            successCount++;
            chunkQueue.push(...message.data);
            scheduleConsumer();
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

    if (chunkQueue.length > 0) {
      const batch = chunkQueue.splice(0, chunkQueue.length);
      consumerQueue.add(async () => {
        indexedChunks += batch.length;
        logger.info('Indexing final batch of chunks', {
          batchSize: batch.length,
          totalIndexedChunks: indexedChunks,
        });
        await indexCodeChunks(batch);
      });
    }

    await consumerQueue.onIdle();

    logger.info('--- Incremental Indexing Summary (Additions/Modifications) ---');
    logger.info(`Successfully processed: ${successCount} files`);
    logger.info(`Failed to parse:      ${failureCount} files`);
    logger.info(`Total chunks indexed: ${indexedChunks}`);
  }

  const newCommitHash = execSync('git rev-parse HEAD', { cwd: directory }).toString().trim();
  await updateLastIndexedCommit(gitBranch, newCommitHash);

  logger.info('---');
  logger.info(`New HEAD commit hash: ${newCommitHash}`);
  logger.info('---');
  logger.info('Incremental indexing complete.');
}
