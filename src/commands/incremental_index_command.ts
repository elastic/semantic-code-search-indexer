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
import { createLogger } from '../utils/logger';
import { IQueue } from '../utils/queue';
import { SqliteQueue } from '../utils/sqlite_queue';
import simpleGit from 'simple-git';
import { createMetrics, createAttributes } from '../utils/metrics';
import {
  MESSAGE_STATUS_SUCCESS,
  MESSAGE_STATUS_FAILURE,
  METRIC_STATUS_SUCCESS,
  METRIC_STATUS_FAILURE,
  LANGUAGE_UNKNOWN,
} from '../utils/constants';



interface IncrementalIndexOptions {
  queueDir: string;
  elasticsearchIndex: string;
  token?: string;
  repoName?: string;
  branch?: string;
}

async function getQueue(options?: IncrementalIndexOptions, repoName?: string, branch?: string): Promise<IQueue> {
  const queueDir = options?.queueDir ?? appConfig.queueDir;
  const queuePath = path.join(queueDir, 'queue.db');
  const queue = new SqliteQueue({
    dbPath: queuePath,
    repoName,
    branch,
  });
  await queue.initialize();
  return queue;
}

export async function incrementalIndex(directory: string, options?: IncrementalIndexOptions) {
  const repoName = options?.repoName ?? path.basename(path.resolve(directory));
  
  const git = simpleGit(directory);
  const gitBranch = options?.branch ?? await git.revparse(['--abbrev-ref', 'HEAD']);

  const logger = createLogger({ name: repoName, branch: gitBranch });
  const metrics = createMetrics({ name: repoName, branch: gitBranch });

  logger.info('Starting incremental indexing process (Producer)', { directory, ...options });
  await setupElser();

  const lastCommitHash = await getLastIndexedCommit(gitBranch, options?.elasticsearchIndex);

  if (!lastCommitHash) {
    logger.warn('No previous commit hash found. Please run a full index first.', { gitBranch });
    return;
  }

  logger.info(`Last indexed commit hash: ${lastCommitHash}`, { gitBranch });

  logger.info('Pulling latest changes from remote', { gitBranch });
  try {
    const token = options?.token || appConfig.githubToken;
    if (token) {
      const remoteUrlRaw = await git.remote(['get-url', 'origin']);
      if (remoteUrlRaw) {
        const remoteUrl = remoteUrlRaw.trim();
        const hasBasicAuth = remoteUrl.includes('oauth2:');
        if (!hasBasicAuth) {
          const newRemoteUrl = remoteUrl.replace('https://', `https://oauth2:${token}@`).trim();
          await git.remote(['set-url', 'origin', newRemoteUrl]);
        } else {
          await git.remote(['set-url', 'origin', remoteUrl]);
        }
      }
    }
    await git.pull('origin', gitBranch);
    logger.info('Pull complete.');
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error('Failed to pull latest changes.', { error: error.message });
    } else {
      logger.error('Failed to pull latest changes with an unknown error.', { error });
    }
    return;
  }

  const gitRoot = await git.revparse(['--show-toplevel']);
  const changedFilesRaw = await git.diff(['--name-status', lastCommitHash, 'HEAD']);

  const changedFiles = changedFilesRaw
    .split('\n')
    .filter(line => line);

  const filesToDelete: string[] = [];
  const filesToIndex: string[] = [];

  for (const line of changedFiles) {
    const parts = line.split('\t');
    const status = parts[0];

    if (status.startsWith('R')) { // Handle Rename (RXXX)
      const oldFile = parts[1];
      const newFile = parts[2];
      filesToDelete.push(oldFile);
      if (SUPPORTED_FILE_EXTENSIONS.includes(path.extname(newFile))) {
        filesToIndex.push(newFile);
      }
    } else if (status.startsWith('C')) { // Handle Copy (CXXX)
      const newFile = parts[2];
      if (SUPPORTED_FILE_EXTENSIONS.includes(path.extname(newFile))) {
        filesToIndex.push(newFile);
      }
    } else if (status === 'D') {
      const file = parts[1];
      filesToDelete.push(file);
    } else if (status === 'A') {
        const file = parts[1];
        if (SUPPORTED_FILE_EXTENSIONS.includes(path.extname(file))) {
            filesToIndex.push(file);
        }
    } else if (status === 'M') {
      const file = parts[1];
      if (SUPPORTED_FILE_EXTENSIONS.includes(path.extname(file))) {
        filesToDelete.push(file);
        filesToIndex.push(file);
      }
    }
  }

  logger.info(`Found ${changedFiles.length} changed files`, {
    toIndex: filesToIndex.length,
    toDelete: filesToDelete.length,
  });

  for (const file of filesToDelete) {
    await deleteDocumentsByFilePath(file, options?.elasticsearchIndex);
    logger.info('Deleted documents for file', { file });
  }

  if (filesToIndex.length === 0) {
    logger.info('No new or modified files to process.');
  } else {
    logger.info('Processing and enqueueing added/modified files...');

    let successCount = 0;
    let failureCount = 0;
    const { cpuCores } = indexingConfig;
    const producerQueue = new PQueue({ concurrency: cpuCores });
    const workQueue: IQueue = await getQueue(options, repoName, gitBranch);

    const producerWorkerPath = path.join(process.cwd(), 'dist', 'utils', 'producer_worker.js');

    filesToIndex.forEach(file => {
      producerQueue.add(() => new Promise<void>((resolve, reject) => {
        const worker = new Worker(producerWorkerPath, {
          workerData: { repoName, gitBranch },
        });
        const absolutePath = path.resolve(gitRoot, file);
        worker.on('message', async (message) => {
          if (message.status === MESSAGE_STATUS_SUCCESS) {
            successCount++;
            
            // Record parser metrics from worker
            if (message.metrics && metrics.parser) {
              const attrs = createAttributes(metrics, {
                language: message.metrics.language,
                parser_type: message.metrics.parserType,
              });
              
              if (message.metrics.filesProcessed > 0) {
                metrics.parser.filesProcessed.add(message.metrics.filesProcessed, {
                  ...attrs,
                  status: METRIC_STATUS_SUCCESS,
                });
              }
              
              if (message.metrics.chunksCreated > 0) {
                metrics.parser.chunksCreated.add(message.metrics.chunksCreated, attrs);
              }
              
              if (message.metrics.chunksSkipped > 0) {
                metrics.parser.chunksSkipped?.add(message.metrics.chunksSkipped, {
                  ...attrs,
                  size: 'oversized',
                });
              }
              
              message.metrics.chunkSizes.forEach((size: number) => {
                metrics.parser?.chunkSize.record(size, attrs);
              });
            }
            
            if (message.data.length > 0) {
              await workQueue.enqueue(message.data);
            }
          } else if (message.status === MESSAGE_STATUS_FAILURE) {
            failureCount++;
            
            // Record failure metric
            if (message.metrics && metrics.parser && message.metrics.filesFailed > 0) {
              metrics.parser.filesFailed.add(message.metrics.filesFailed, createAttributes(metrics, {
                language: message.metrics.language || LANGUAGE_UNKNOWN,
                status: METRIC_STATUS_FAILURE,
              }));
            }
            
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

  const newCommitHash = await git.revparse(['HEAD']);
  await updateLastIndexedCommit(gitBranch, newCommitHash, options?.elasticsearchIndex);

  logger.info('---');
  logger.info(`New HEAD commit hash: ${newCommitHash}`);
  logger.info('---');
  logger.info('Incremental file parsing and enqueueing complete.');
}



export const incrementalIndexCommand = new Command('incremental-index')
  .description('Incrementally index a directory')
  .argument('[directory]', 'The directory to index', '.')
  .action(incrementalIndex);
