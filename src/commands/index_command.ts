import { Command, Option } from 'commander';
import { glob } from 'glob';
import {
  createIndex,
  deleteIndex,
  createSettingsIndex,
  updateLastIndexedCommit,
} from '../utils/elasticsearch';
import { LanguageParser } from '../utils/parser';
import { indexingConfig, appConfig } from '../config';
import path from 'path';
import { Worker } from 'worker_threads';
import PQueue from 'p-queue';
import { execSync } from 'child_process';
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

interface IndexOptions {
  queueDir?: string;
  elasticsearchIndex?: string;
  repoName?: string;
  branch?: string;
}

async function getQueue(options?: IndexOptions, repoName?: string, branch?: string): Promise<IQueue> {
  const queueDir = options?.queueDir ?? appConfig.queueDir;
  const queueDbPath = path.join(queueDir, 'queue.db');
  const queue = new SqliteQueue({
    dbPath: queueDbPath,
    repoName,
    branch,
  });
  await queue.initialize();
  return queue;
}

export async function index(directory: string, clean: boolean, options?: IndexOptions) {
  const repoName = options?.repoName ?? path.basename(path.resolve(directory));
  const gitBranch = options?.branch ?? execSync('git rev-parse --abbrev-ref HEAD', { cwd: directory })
    .toString()
    .trim();

  const logger = createLogger({ name: repoName, branch: gitBranch });
  const metrics = createMetrics({ name: repoName, branch: gitBranch });

  const languageParser = new LanguageParser();
  const supportedFileExtensions = Array.from(languageParser.fileSuffixMap.keys());
  logger.info('Starting full indexing process (Producer)', { directory, clean, supportedFileExtensions });
  if (clean) {
    logger.info('Clean flag is set, deleting existing index.');
    await deleteIndex(options?.elasticsearchIndex);
  }

  await createIndex(options?.elasticsearchIndex);
  await createSettingsIndex(options?.elasticsearchIndex);

  const gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory }).toString().trim();
  const ig = ignore();
  const gitignorePath = path.join(gitRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, 'utf8'));
  }
  ig.add(['**/*_lexer.ts', '**/*_parser.ts']);

  const relativeSearchDir = path.relative(gitRoot, directory);

  const extensionPattern = supportedFileExtensions.length === 1 ? supportedFileExtensions.join(',') : `{${supportedFileExtensions.join(',')}}`;
  const globPattern = path.join(relativeSearchDir, `**/*${extensionPattern}`);

  const allFiles = await glob(globPattern, {
    cwd: gitRoot,
  });
  const files = ig.filter(allFiles);

  logger.info(`Found ${files.length} files to process.`);

  let successCount = 0;
  let failureCount = 0;

  const { cpuCores } = indexingConfig;
  const producerQueue = new PQueue({ concurrency: cpuCores });
  
  const workQueue: IQueue = await getQueue(options, repoName, gitBranch);

  const producerWorkerPath = path.join(process.cwd(), 'dist', 'utils', 'producer_worker.js');

  files.forEach(file => {
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
            
            // Debug: Log histogram recording
            if (message.metrics.chunkSizes.length > 0) {
              logger.debug(`Recorded ${message.metrics.chunkSizes.length} chunk size measurements`, {
                min: Math.min(...message.metrics.chunkSizes),
                max: Math.max(...message.metrics.chunkSizes),
                avg: message.metrics.chunkSizes.reduce((a: number, b: number) => a + b, 0) / message.metrics.chunkSizes.length,
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

  const commitHash = execSync('git rev-parse HEAD', { cwd: directory }).toString().trim();
  await updateLastIndexedCommit(gitBranch, commitHash, options?.elasticsearchIndex);

  logger.info('--- Producer Summary ---');
  logger.info(`Successfully processed: ${successCount} files`);
  logger.info(`Failed to parse:      ${failureCount} files`);
  logger.info(`HEAD commit hash:     ${commitHash}`);
  logger.info('---');
  logger.info('File parsing and enqueueing complete.');
}

export const indexCommand = new Command('index')
  .description('Index a directory, optionally deleting the old index first')
  .argument('[directory]', 'The directory to index', '.')
  .addOption(new Option('--clean', 'Delete the existing index before indexing'))
  .action(async (directory, options) => {
    await index(directory, options.clean);
  });