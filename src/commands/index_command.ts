
import { glob } from 'glob';
import { createIndex, indexCodeChunks, deleteIndex, CodeChunk, setupElser } from '../utils';
import path from 'path';
import os from 'os';
import { Worker } from 'worker_threads';
import cliProgress from 'cli-progress';
import PQueue from 'p-queue';
import { execSync } from 'child_process';

export async function index(directory: string, clean: boolean) {
  if (clean) {
    await deleteIndex();
  }

  await setupElser();
  console.log(`Indexing directory: ${directory}`);
  await createIndex();

  const files = await glob('**/*.{ts,tsx,js,jsx}', {
    cwd: directory,
    ignore: ['node_modules/**', '**/*_lexer.ts', '**/*_parser.ts'],
    absolute: true,
  });

  console.log(`Found ${files.length} files to index.`);

  // Create a multibar container
  const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: '{bar} | {percentage}% | {value}/{total} | {task}',
  }, cliProgress.Presets.shades_classic);

  const processingBar = multibar.create(files.length, 0, { task: 'Processing files' });
  // We'll create the indexing bar later, when we know the total.

  const BATCH_SIZE = 500;
  const chunkQueue: CodeChunk[] = [];
  const queue = new PQueue({ concurrency: os.cpus().length });

  let successCount = 0;
  let failureCount = 0;
  const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: directory }).toString().trim();
  const gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory }).toString().trim();

  const processFileWithWorker = (file: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(process.cwd(), 'dist', 'utils', 'worker.js'));
      worker.on('message', (message) => {
        processingBar.increment();
        if (message.status === 'success') {
          successCount++;
          chunkQueue.push(...message.data);
        } else if (message.status === 'failure') {
          failureCount++;
        }
        worker.terminate();
        resolve();
      });
      worker.on('error', (err) => {
        failureCount++;
        processingBar.increment();
        worker.terminate();
        reject(err);
      });
      const relativePath = path.relative(gitRoot, file);
      worker.postMessage({ filePath: file, gitBranch, relativePath });
    });
  };

  // Producer Promise
  const producerPromise = (async () => {
    files.forEach(file => queue.add(() => processFileWithWorker(file)));
    await queue.onIdle();
  })();

  // Consumer Promise
  const consumerPromise = (async () => {
    await producerPromise; // Wait for the producer to finish

    const indexingBar = multibar.create(chunkQueue.length, 0, { task: 'Indexing chunks ' });
    
    while (chunkQueue.length > 0) {
      const batch = chunkQueue.splice(0, BATCH_SIZE);
      await indexCodeChunks(batch);
      indexingBar.increment(batch.length);
    }
  })();

  await Promise.all([producerPromise, consumerPromise]);
  multibar.stop();

  console.log('\n---');
  console.log('Indexing Summary:');
  console.log(`  Successfully processed: ${successCount} files`);
  console.log(`  Failed to parse:      ${failureCount} files`);
  console.log('---');
  console.log('Indexing complete.');
}
