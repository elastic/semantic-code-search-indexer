import { glob } from 'glob';
import { createIndex, deleteIndex, createSettingsIndex } from '../utils/elasticsearch';
import { LanguageParser } from '../utils/parser';
import { indexingConfig } from '../config';
import path from 'path';
import { Worker } from 'worker_threads';
import PQueue from 'p-queue';
import { execFileSync } from 'child_process';
import fs from 'fs';
import ignore from 'ignore';
import { createLogger } from '../utils/logger';
import { IQueue } from '../utils/queue';
import { SqliteQueue } from '../utils/sqlite_queue';
import { createMetrics, createAttributes } from '../utils/metrics';
import {
  MESSAGE_STATUS_SUCCESS,
  MESSAGE_STATUS_FAILURE,
  METRIC_STATUS_SUCCESS,
  METRIC_STATUS_FAILURE,
  LANGUAGE_UNKNOWN,
} from '../utils/constants';

export interface IndexOptions {
  queueDir: string;
  elasticsearchIndex?: string;
  repoName?: string;
  branch?: string;
  token?: string;
}

async function getQueue(options: IndexOptions, repoName?: string, branch?: string): Promise<IQueue> {
  const queueDbPath = path.join(options.queueDir, 'queue.db');
  const queue = new SqliteQueue({
    dbPath: queueDbPath,
    repoName,
    branch,
  });
  await queue.initialize();
  return queue;
}

export async function index(directory: string, clean: boolean, options: IndexOptions) {
  const repoName = options?.repoName ?? path.basename(path.resolve(directory));
  // Use execFileSync to prevent shell injection from special characters in directory paths
  const gitBranch =
    options?.branch ??
    execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: directory,
    })
      .toString()
      .trim();

  const logger = createLogger({ name: repoName, branch: gitBranch });
  const metrics = createMetrics({ name: repoName, branch: gitBranch });

  const languageParser = new LanguageParser();
  const supportedFileExtensions = Array.from(languageParser.fileSuffixMap.keys());
  logger.info('Starting full indexing process', {
    directory,
    clean,
    supportedFileExtensions,
  });
  if (clean) {
    logger.info('Clean flag is set, deleting existing index and clearing queue.');
    await deleteIndex(options?.elasticsearchIndex);

    // Clear the queue when doing a clean reindex
    const workQueue: IQueue = await getQueue(options, repoName, gitBranch);
    await workQueue.clear();
  }

  await createIndex(options?.elasticsearchIndex);
  await createSettingsIndex(options?.elasticsearchIndex);

  // Use execFileSync to prevent shell injection from special characters in directory paths
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: directory,
  })
    .toString()
    .trim();
  const ig = ignore();
  const gitignorePath = path.join(gitRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, 'utf8'));
  }

  // Load .indexerignore if it exists
  const indexerignorePath = path.join(gitRoot, '.indexerignore');
  if (fs.existsSync(indexerignorePath)) {
    ig.add(fs.readFileSync(indexerignorePath, 'utf8'));
    logger.info(`Loaded .indexerignore with custom exclusions`);
  }

  ig.add(['**/*_lexer.ts', '**/*_parser.ts']);

  const relativeSearchDir = path.relative(gitRoot, directory);

  const extensionPattern =
    supportedFileExtensions.length === 1 ? supportedFileExtensions.join(',') : `{${supportedFileExtensions.join(',')}}`;
  const globPattern = path.join(relativeSearchDir, `**/*${extensionPattern}`);

  const allFiles = await glob(globPattern, {
    cwd: gitRoot,
  });

  // Normalize to relative paths - glob may return absolute paths despite cwd
  // Use fs.realpathSync to resolve symlinks (e.g., /tmp -> /private/tmp on macOS)
  const realGitRoot = fs.realpathSync(gitRoot);
  const relativeFiles = allFiles.map((f) => {
    if (path.isAbsolute(f)) {
      const realPath = fs.realpathSync(f);
      return path.relative(realGitRoot, realPath);
    }
    return f;
  });

  const files = ig.filter(relativeFiles);

  logger.info(`Found ${files.length} files to process.`);

  let successCount = 0;
  let failureCount = 0;

  const { cpuCores } = indexingConfig;
  const producerQueue = new PQueue({ concurrency: cpuCores });

  const workQueue: IQueue = await getQueue(options, repoName, gitBranch);

  const producerWorkerPath = path.join(process.cwd(), 'dist', 'utils', 'producer_worker.js');

  files.forEach((file) => {
    producerQueue.add(
      () =>
        new Promise<void>((resolve, reject) => {
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

                // Debug: Log histogram recording
                if (message.metrics.chunkSizes.length > 0) {
                  logger.debug(`Recorded ${message.metrics.chunkSizes.length} chunk size measurements`, {
                    min: Math.min(...message.metrics.chunkSizes),
                    max: Math.max(...message.metrics.chunkSizes),
                    avg:
                      message.metrics.chunkSizes.reduce((a: number, b: number) => a + b, 0) /
                      message.metrics.chunkSizes.length,
                  });
                }
              }

              if (message.data.length > 0) {
                await workQueue.enqueue(message.data);
              }
            } else if (message.status === MESSAGE_STATUS_FAILURE) {
              failureCount++;

              // Record failure metric
              if (message.metrics && metrics.parser && message.metrics.filesFailed > 0) {
                metrics.parser.filesFailed.add(
                  message.metrics.filesFailed,
                  createAttributes(metrics, {
                    language: message.metrics.language || LANGUAGE_UNKNOWN,
                    status: METRIC_STATUS_FAILURE,
                  })
                );
              }

              logger.warn('Failed to parse file', {
                file: message.filePath,
                error: message.error,
              });
            }
            worker.terminate();
            resolve();
          });
          worker.on('error', (err) => {
            failureCount++;
            logger.error('Worker thread error', { file, error: err.message });
            worker.terminate();
            reject(err);
          });
          const relativePath = file;
          worker.postMessage({
            filePath: absolutePath,
            gitBranch,
            relativePath,
          });
        })
    );
  });

  await producerQueue.onIdle();

  // Use execFileSync to prevent shell injection from special characters in directory paths
  const commitHash = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: directory,
  })
    .toString()
    .trim();

  logger.info('--- Indexing Summary ---');
  logger.info(`Successfully processed: ${successCount} files`);
  logger.info(`Failed to parse:      ${failureCount} files`);
  logger.info(`HEAD commit hash:     ${commitHash}`);
  logger.info('---');
  logger.info('File parsing and enqueueing complete.');

  // Mark enqueue as completed
  await workQueue.markEnqueueCompleted();

  logger.info('Note: Commit hash will be updated after worker completes successfully.');
}
