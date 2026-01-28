import { createLocationsIndex, deleteDocumentsByFilePaths, getLastIndexedCommit } from '../utils/elasticsearch';
import { languageConfigurations, parseLanguageNames } from '../languages';
import { indexingConfig } from '../config';
import path from 'path';
import { Worker } from 'worker_threads';
import PQueue from 'p-queue';
import { createLogger } from '../utils/logger';
import { IQueueWithEnqueueMetadata } from '../utils/queue';
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

export interface IncrementalIndexOptions {
  queueDir: string;
  elasticsearchIndex?: string;
  token?: string;
  repoName?: string;
  branch?: string;
}

async function getQueue(
  options: IncrementalIndexOptions,
  repoName?: string,
  branch?: string
): Promise<IQueueWithEnqueueMetadata> {
  const queuePath = path.join(options.queueDir, 'queue.db');
  const queue = new SqliteQueue({
    dbPath: queuePath,
    repoName,
    branch,
  });
  await queue.initialize();
  return queue;
}

export async function incrementalIndex(directory: string, options: IncrementalIndexOptions) {
  const repoName = options?.repoName ?? path.basename(path.resolve(directory));

  const git = simpleGit(directory);
  const gitBranch = options?.branch ?? (await git.revparse(['--abbrev-ref', 'HEAD']));

  const logger = createLogger({ name: repoName, branch: gitBranch });
  const metrics = createMetrics({ name: repoName, branch: gitBranch });

  const supportedExtensions = new Set<string>();
  const enabledLanguageNames = parseLanguageNames(process.env.SEMANTIC_CODE_INDEXER_LANGUAGES);
  enabledLanguageNames.forEach((name) => {
    const config = languageConfigurations[name];
    config.fileSuffixes.forEach((suffix) => supportedExtensions.add(suffix));
  });

  logger.info('Starting incremental indexing process', {
    directory,
    ...options,
  });

  const lastCommitHash = await getLastIndexedCommit(gitBranch, options?.elasticsearchIndex);

  if (!lastCommitHash) {
    logger.warn('No previous commit hash found. Please run a full index first.', { gitBranch });
    return;
  }

  // Ensure the locations store exists for this index. This allows upgrading existing deployments
  // without requiring a full clean reindex just to create the new index.
  await createLocationsIndex(options?.elasticsearchIndex);

  logger.info(`Last indexed commit hash: ${lastCommitHash}`, { gitBranch });

  const gitRoot = await git.revparse(['--show-toplevel']);
  const changedFilesRaw = await git.diff(['--name-status', lastCommitHash, 'HEAD']);

  const changedFiles = changedFilesRaw.split('\n').filter((line) => line);

  const filesToDelete: string[] = [];
  const filesToIndex: string[] = [];

  for (const line of changedFiles) {
    const parts = line.split('\t');
    const status = parts[0];

    if (status.startsWith('R')) {
      // Handle Rename (RXXX)
      const oldFile = parts[1];
      const newFile = parts[2];
      filesToDelete.push(oldFile);
      if (supportedExtensions.has(path.extname(newFile))) {
        filesToIndex.push(newFile);
      }
    } else if (status.startsWith('C')) {
      // Handle Copy (CXXX)
      const newFile = parts[2];
      if (supportedExtensions.has(path.extname(newFile))) {
        filesToIndex.push(newFile);
      }
    } else if (status === 'D') {
      const file = parts[1];
      filesToDelete.push(file);
    } else if (status === 'A') {
      const file = parts[1];
      if (supportedExtensions.has(path.extname(file))) {
        filesToIndex.push(file);
      }
    } else if (status === 'M') {
      const file = parts[1];
      // Always remove stale indexed locations for changed files, even if this file type is no
      // longer enabled. Otherwise changing SEMANTIC_CODE_INDEXER_LANGUAGES can leave stale docs.
      filesToDelete.push(file);
      if (supportedExtensions.has(path.extname(file))) {
        filesToIndex.push(file);
      }
    }
  }

  logger.info(`Found ${changedFiles.length} changed files`, {
    toIndex: filesToIndex.length,
    toDelete: filesToDelete.length,
  });

  let workQueue: IQueueWithEnqueueMetadata | undefined;

  if (filesToDelete.length > 0) {
    logger.info('Removing stale indexed locations for changed/deleted files...', { count: filesToDelete.length });
    await deleteDocumentsByFilePaths(filesToDelete, options?.elasticsearchIndex);
    logger.info('Removed stale indexed locations for changed/deleted files.', { count: filesToDelete.length });
  }

  if (filesToIndex.length === 0) {
    logger.info('No new or modified files to process.');
  } else {
    logger.info('Processing and enqueueing added/modified files...');

    let successCount = 0;
    let failureCount = 0;
    const { cpuCores } = indexingConfig;
    const enqueueQueue = await getQueue(options, repoName, gitBranch);
    workQueue = enqueueQueue;
    // Ensure enqueue completion metadata reflects this run. If the process dies mid-enqueue,
    // the index command can detect it and safely re-enqueue from scratch.
    await enqueueQueue.markEnqueueStarted();

    const producerWorkerPath = path.join(process.cwd(), 'dist', 'utils', 'producer_worker.js');

    const configuredPoolSize = Number.isFinite(indexingConfig.producerWorkerPoolSize)
      ? Math.floor(indexingConfig.producerWorkerPoolSize)
      : cpuCores;
    const poolSize = Math.max(1, Math.min(cpuCores, configuredPoolSize, filesToIndex.length));

    const producerQueue = new PQueue({ concurrency: poolSize });

    const workers = Array.from(
      { length: poolSize },
      () =>
        new Worker(producerWorkerPath, {
          workerData: { repoName, gitBranch },
        })
    );

    const idleWorkers: Worker[] = workers.slice();
    const waiters: Array<(worker: Worker) => void> = [];

    const acquireWorker = async (): Promise<Worker> => {
      const worker = idleWorkers.pop();
      if (worker) return worker;
      return await new Promise<Worker>((resolve) => waiters.push(resolve));
    };

    const releaseWorker = (worker: Worker): void => {
      const waiter = waiters.shift();
      if (waiter) {
        waiter(worker);
      } else {
        idleWorkers.push(worker);
      }
    };

    const addOneTimeListener = (
      worker: Worker,
      event: 'message' | 'error',
      handler: (...args: unknown[]) => void
    ): (() => void) => {
      const w = worker as unknown as {
        once?: (event: string, handler: (...args: unknown[]) => void) => void;
        on: (event: string, handler: (...args: unknown[]) => void) => void;
        off?: (event: string, handler: (...args: unknown[]) => void) => void;
        removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
      };

      if (typeof w.once === 'function') {
        w.once(event, handler);
        // Critical: remove the listener when the opposite event wins the race.
        // (On Node.js, removeListener(event, originalHandler) also removes the internal once wrapper.)
        return () => {
          if (typeof w.off === 'function') {
            w.off(event, handler);
          } else if (typeof w.removeListener === 'function') {
            w.removeListener(event, handler);
          }
        };
      }

      w.on(event, handler);
      return () => {
        if (typeof w.off === 'function') {
          w.off(event, handler);
        } else if (typeof w.removeListener === 'function') {
          w.removeListener(event, handler);
        }
      };
    };

    const runParseJob = async (file: string): Promise<void> => {
      const relativePath = file;
      const absolutePath = path.resolve(gitRoot, file);

      const worker = await acquireWorker();
      try {
        const message = await new Promise<unknown>((resolve, reject) => {
          const cleanups: Array<() => void> = [];
          const cleanup = () => cleanups.forEach((fn) => fn());

          cleanups.push(
            addOneTimeListener(worker, 'message', (msg: unknown) => {
              cleanup();
              resolve(msg);
            })
          );

          cleanups.push(
            addOneTimeListener(worker, 'error', (err: unknown) => {
              cleanup();
              reject(err);
            })
          );

          worker.postMessage({
            filePath: absolutePath,
            gitBranch,
            relativePath,
          });
        });

        const payload = message as {
          status?: unknown;
          data?: unknown;
          metrics?: unknown;
          error?: unknown;
          filePath?: unknown;
        };

        const status = payload.status;
        const metricsPayload = payload.metrics as
          | {
              filesProcessed?: unknown;
              filesFailed?: unknown;
              chunksCreated?: unknown;
              chunksSkipped?: unknown;
              chunkSizes?: unknown;
              language?: unknown;
              parserType?: unknown;
            }
          | undefined;

        if (status === MESSAGE_STATUS_SUCCESS) {
          successCount++;

          // Record parser metrics from worker
          if (metricsPayload && metrics.parser) {
            const attrs = createAttributes(metrics, {
              language: typeof metricsPayload.language === 'string' ? metricsPayload.language : LANGUAGE_UNKNOWN,
              parser_type: typeof metricsPayload.parserType === 'string' ? metricsPayload.parserType : '',
            });

            const filesProcessed =
              typeof metricsPayload.filesProcessed === 'number' ? metricsPayload.filesProcessed : 0;
            const chunksCreated = typeof metricsPayload.chunksCreated === 'number' ? metricsPayload.chunksCreated : 0;
            const chunksSkipped = typeof metricsPayload.chunksSkipped === 'number' ? metricsPayload.chunksSkipped : 0;
            const chunkSizes = Array.isArray(metricsPayload.chunkSizes) ? metricsPayload.chunkSizes : [];

            if (filesProcessed > 0) {
              metrics.parser.filesProcessed.add(filesProcessed, {
                ...attrs,
                status: METRIC_STATUS_SUCCESS,
              });
            }

            if (chunksCreated > 0) {
              metrics.parser.chunksCreated.add(chunksCreated, attrs);
            }

            if (chunksSkipped > 0) {
              metrics.parser.chunksSkipped?.add(chunksSkipped, {
                ...attrs,
                size: 'oversized',
              });
            }

            chunkSizes.forEach((size: unknown) => {
              if (typeof size === 'number') {
                metrics.parser?.chunkSize.record(size, attrs);
              }
            });
          }

          if (Array.isArray(payload.data) && payload.data.length > 0) {
            await enqueueQueue.enqueue(payload.data);
          }
          return;
        }

        if (status === MESSAGE_STATUS_FAILURE) {
          failureCount++;

          // Record failure metric
          const filesFailed = typeof metricsPayload?.filesFailed === 'number' ? metricsPayload.filesFailed : 0;
          const language = typeof metricsPayload?.language === 'string' ? metricsPayload.language : LANGUAGE_UNKNOWN;
          if (metricsPayload && metrics.parser && filesFailed > 0) {
            metrics.parser.filesFailed.add(
              filesFailed,
              createAttributes(metrics, {
                language,
                status: METRIC_STATUS_FAILURE,
              })
            );
          }

          logger.warn('Failed to parse file', {
            file: typeof payload.filePath === 'string' ? payload.filePath : absolutePath,
            error: typeof payload.error === 'string' ? payload.error : 'Unknown error',
          });
          return;
        }

        failureCount++;
        logger.warn('Unexpected worker response while parsing file', { file: relativePath, status });
      } catch (err) {
        failureCount++;
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Worker thread error', { file, error: message });
      } finally {
        releaseWorker(worker);
      }
    };

    filesToIndex.forEach((file) => {
      producerQueue.add(() => runParseJob(file));
    });

    await producerQueue.onIdle();
    await Promise.all(workers.map(async (w) => await w.terminate()));

    logger.info('--- Incremental Indexing Summary (Additions/Modifications) ---');
    logger.info(`Successfully processed: ${successCount} files`);
    logger.info(`Failed to parse:      ${failureCount} files`);
  }

  const newCommitHash = await git.revparse(['HEAD']);

  // If we enqueued any work during this run, persist enqueue metadata for the resume path.
  // (If there were no files to index, nothing is enqueued, so we do not touch enqueue metadata.)
  if (workQueue) {
    await workQueue.setEnqueueCommitHash(newCommitHash);
    await workQueue.markEnqueueCompleted();
  }

  logger.info('---');
  logger.info(`New HEAD commit hash: ${newCommitHash}`);
  logger.info('---');
  logger.info('Incremental file parsing and enqueueing complete.');
  logger.info('Note: Commit hash will be updated after worker completes successfully.');
}
