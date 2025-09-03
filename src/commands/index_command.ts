import { glob } from 'glob';
import {
  createIndex,
  deleteIndex,
  setupElser,
  createSettingsIndex,
  updateLastIndexedCommit,
  CodeChunk,
  indexCodeChunks,
} from '../utils/elasticsearch';
import { LanguageParser } from '../utils/parser';
import { indexingConfig } from '../config';
import path from 'path';
import { Worker } from 'worker_threads';
import PQueue from 'p-queue';
import { execSync } from 'child_process';
import fs from 'fs';
import ignore from 'ignore';
import { logger } from '../utils/logger';

/**
 * The main function for the `index` command.
 *
 * This function is responsible for orchestrating the entire indexing process.
 * It discovers files, manages producer and consumer queues for parsing and
 * indexing, and updates the last indexed commit hash at the end.
 *
 * @param directory The directory to index.
 * @param clean Whether to delete the existing index before indexing.
 */
export async function index(directory: string, clean: boolean) {
  const languageParser = new LanguageParser();
  const supportedFileExtensions = Array.from(languageParser.fileSuffixMap.keys());
  logger.info('Starting full indexing process', { directory, clean, supportedFileExtensions });
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

  // Only surround the extensions with {} when there is more that one
  const extensionPattern = supportedFileExtensions.length === 1 ? supportedFileExtensions.join(',') : `{${supportedFileExtensions.join(',')}}`;
  const globPattern = path.join(relativeSearchDir, `**/*${extensionPattern}`);

  const allFiles = await glob(globPattern, {
    cwd: gitRoot,
  });
  const files = ig.filter(allFiles);

  logger.info(`Found ${files.length} files to index.`);

  let successCount = 0;
  let failureCount = 0;
  const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: directory })
    .toString()
    .trim();

  const { batchSize, cpuCores } = indexingConfig;
  const producerQueue = new PQueue({ concurrency: cpuCores });
  const consumerQueue = new PQueue({ concurrency: 1 }); // Concurrency of 1 for Elasticsearch indexing

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
          totalFiles: files.length,
        });
        await indexCodeChunks(batch);
      });
    }
  };

  files.forEach(file => {
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
      // The `file` path from glob is already relative to gitRoot
      const relativePath = file;
      worker.postMessage({ filePath: absolutePath, gitBranch, relativePath });
    }));
  });

  await producerQueue.onIdle();

  // Schedule any remaining chunks
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

  const commitHash = execSync('git rev-parse HEAD', { cwd: directory }).toString().trim();
  await updateLastIndexedCommit(gitBranch, commitHash);

  logger.info('--- Indexing Summary ---');
  logger.info(`Successfully processed: ${successCount} files`);
  logger.info(`Failed to parse:      ${failureCount} files`);
  logger.info(`Total chunks indexed: ${indexedChunks}`);
  logger.info(`HEAD commit hash:     ${commitHash}`);
  logger.info('---');
  logger.info('Full indexing complete.');
}
