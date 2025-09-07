import { Command, Option } from 'commander';
import { glob } from 'glob';
import {
  createIndex,
  deleteIndex,
  setupElser,
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
import { logger } from '../utils/logger';
import { IQueue } from '../utils/queue';
import { SqliteQueue } from '../utils/sqlite_queue';

async function getQueue(): Promise<IQueue> {
  const queue = new SqliteQueue(appConfig.queueDir);
  await queue.initialize();
  return queue;
}

async function index(directory: string, clean: boolean) {
  const languageParser = new LanguageParser();
  const supportedFileExtensions = Array.from(languageParser.fileSuffixMap.keys());
  logger.info('Starting full indexing process (Producer)', { directory, clean, supportedFileExtensions });
  if (clean) {
    logger.info('Clean flag is set, deleting existing index.');
    await deleteIndex();
  }

  await setupElser();
  await createIndex();
  await createSettingsIndex();

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
  const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: directory })
    .toString()
    .trim();

  const { cpuCores } = indexingConfig;
  const producerQueue = new PQueue({ concurrency: cpuCores });
  
  const workQueue: IQueue = await getQueue();

  const producerWorkerPath = path.join(process.cwd(), 'dist', 'utils', 'producer_worker.js');

  files.forEach(file => {
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

  const commitHash = execSync('git rev-parse HEAD', { cwd: directory }).toString().trim();
  await updateLastIndexedCommit(gitBranch, commitHash);

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