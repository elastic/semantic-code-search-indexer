import { glob } from 'glob';
import {
  indexCodeChunks,
  CodeChunk,
  setupElser,
  getLastIndexedCommit,
  updateLastIndexedCommit,
  deleteDocumentsByFilePath,
  SUPPORTED_FILE_EXTENSIONS,
} from '../utils';
import path from 'path';
import os from 'os';
import { Worker } from 'worker_threads';
import cliProgress from 'cli-progress';
import PQueue from 'p-queue';
import { execSync } from 'child_process';

export async function incrementalIndex(directory: string) {
  await setupElser();
  console.log(`Incrementally indexing directory: ${directory}`);

  const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: directory })
    .toString()
    .trim();
  const lastCommitHash = await getLastIndexedCommit(gitBranch);

  if (!lastCommitHash) {
    console.log('No previous commit hash found. Please run a full index first.');
    return;
  }

  console.log(`Last indexed commit hash: ${lastCommitHash}`);

  const gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory }).toString().trim();
  const changedFiles = execSync(`git diff --name-status ${lastCommitHash} HEAD`, {
    cwd: directory,
  })
    .toString()
    .trim()
    .split('\n')
    .filter(line => line)
    .map(line => {
      const [status, file] = line.split('\t');
      return { status, file: path.join(gitRoot, file) };
    });

  const deletedFiles = changedFiles
    .filter(f => f.status === 'D')
    .map(f => path.relative(gitRoot, f.file));
  const addedOrModifiedFiles = changedFiles
    .filter(
      f =>
        (f.status === 'A' || f.status === 'M') && SUPPORTED_FILE_EXTENSIONS.includes(path.extname(f.file))
    )
    .map(f => f.file);

  console.log(`Found ${changedFiles.length} changed files.`);
  console.log(`  - ${addedOrModifiedFiles.length} added or modified`);
  console.log(`  - ${deletedFiles.length} deleted`);

  // Process deletions
  for (const file of deletedFiles) {
    await deleteDocumentsByFilePath(file);
  }

  // Process additions/modifications
  const multibar = new cliProgress.MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      format: '{bar} | {percentage}% | {value}/{total} | {task}',
    },
    cliProgress.Presets.shades_classic
  );

  const processingBar = multibar.create(addedOrModifiedFiles.length, 0, {
    task: 'Processing files',
  });

  const BATCH_SIZE = 500;
  const chunkQueue: CodeChunk[] = [];
  const queue = new PQueue({ concurrency: os.cpus().length });

  let successCount = 0;
  let failureCount = 0;

  const processFileWithWorker = (file: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(process.cwd(), 'dist', 'utils', 'worker.js'));
      worker.on('message', message => {
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
      worker.on('error', err => {
        failureCount++;
        processingBar.increment();
        worker.terminate();
        reject(err);
      });
      const relativePath = path.relative(gitRoot, file);
      worker.postMessage({ filePath: file, gitBranch, relativePath });
    });
  };

  const producerPromise = (async () => {
    addedOrModifiedFiles.forEach(file => queue.add(() => processFileWithWorker(file)));
    await queue.onIdle();
  })();

  const consumerPromise = (async () => {
    await producerPromise;

    const indexingBar = multibar.create(chunkQueue.length, 0, { task: 'Indexing chunks ' });

    while (chunkQueue.length > 0) {
      const batch = chunkQueue.splice(0, BATCH_SIZE);
      await indexCodeChunks(batch);
      indexingBar.increment(batch.length);
    }
  })();

  await Promise.all([producerPromise, consumerPromise]);
  multibar.stop();

  const newCommitHash = execSync('git rev-parse HEAD', { cwd: directory }).toString().trim();
  await updateLastIndexedCommit(gitBranch, newCommitHash);

  console.log('\n---');
  console.log('Incremental Indexing Summary:');
  console.log(`  Successfully processed: ${successCount} files`);
  console.log(`  Failed to parse:      ${failureCount} files`);
  console.log(`  New HEAD commit hash: ${newCommitHash}`);
  console.log('---');
  console.log('Incremental indexing complete.');
}
