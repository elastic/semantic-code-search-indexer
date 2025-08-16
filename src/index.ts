import './config'; // Must be the first import
import { glob } from 'glob';
import { createIndex, indexCodeChunks, searchCodeChunks, deleteIndex, CodeChunk } from './elasticsearch';
import { LanguageServerService } from './language_server';
import path from 'path';
import { findProjectRoot } from './utils';
import os from 'os';
import { Readable } from 'stream';
import { Worker } from 'worker_threads';
import { initializeEmbeddingModel, generateEmbedding } from './embedding'; // For search

async function index(directory: string, clean: boolean) {
  if (clean) {
    await deleteIndex();
  }

  console.log(`Indexing directory: ${directory}`);
  await createIndex();

  const files = await glob('**/*.{ts,tsx,js,jsx}', {
    cwd: directory,
    ignore: 'node_modules/**',
    absolute: true,
  });

  console.log(`Found ${files.length} files to index.`);

  // --- WORKER THREADS ARCHITECTURE WITH BACKPRESSURE ---

  const chunkStream = new Readable({
    objectMode: true,
    read() {},
  });

  const consumerPromise = indexCodeChunks(chunkStream);

  const producerPromise = new Promise<void>((resolve, reject) => {
    const numWorkers = os.cpus().length;
    const fileQueue = [...files];
    let activeWorkers = 0;
    let pausedWorkers: Worker[] = [];

    console.log(`Starting ${numWorkers} worker threads...`);

    const processNextFile = (worker: Worker) => {
      const file = fileQueue.pop();
      if (file) {
        worker.postMessage(file);
      } else {
        worker.terminate();
        activeWorkers--;
        if (activeWorkers === 0) {
          chunkStream.push(null);
          resolve();
        }
      }
    };

    const resumePausedWorkers = () => {
      while (pausedWorkers.length > 0) {
        const worker = pausedWorkers.pop();
        if (worker) {
          processNextFile(worker);
        }
      }
    };

    chunkStream.on('drain', resumePausedWorkers);

    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker(path.join(process.cwd(), 'dist', 'worker.js'));
      worker.on('message', (message) => {
        if (message === 'ready') {
          activeWorkers++;
          processNextFile(worker);
        } else if (message.status === 'done') {
          const canContinue = message.data.every((chunk: CodeChunk) => chunkStream.push(chunk));
          if (canContinue) {
            processNextFile(worker);
          } else {
            pausedWorkers.push(worker);
          }
        } else if (message.status === 'error') {
          console.error(`Error from worker:`, message.error);
          processNextFile(worker);
        }
      });
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
      });
    }
  });

  await Promise.all([producerPromise, consumerPromise]);

  console.log('Indexing complete.');
}

// ... (search, references, and main functions remain the same) ...
async function search(query: string) {
  await initializeEmbeddingModel();
  console.log(`Searching for: "${query}"`);
  const queryEmbedding = await generateEmbedding(query);
  const results = await searchCodeChunks(queryEmbedding);

  console.log('Search results:');
  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  results.forEach(result => {
    console.log('---');
    console.log(`File: ${result.filePath}`);
    console.log(`Lines: ${result.startLine} - ${result.endLine}`);
    console.log(`Score: ${result.score}`);
    console.log('Content:');
    console.log(result.content);
  });
}

async function references(filePath: string, line: number, character: number) {
  const absoluteFilePath = path.resolve(filePath);
  const projectRoot = findProjectRoot(absoluteFilePath);

  if (!projectRoot) {
    console.error(`Could not find a tsconfig.json for the file: ${filePath}`);
    process.exit(1);
  }

  const languageServer = new LanguageServerService();

  console.log(`Found project root: ${projectRoot}`);
  console.log('Initializing language server...');
  await languageServer.initialize(projectRoot);
  console.log('Language server initialized.');

  console.log(`Finding references for ${absoluteFilePath}:${line}:${character}`);
  const results = await languageServer.findAllReferences(absoluteFilePath, line, character);

  if (results && results.length > 0) {
    console.log('Found references:');
    results.forEach(result => {
      const resultPath = result.uri.replace(`file://${projectRoot}/`, '');
      console.log(`  - ${resultPath}:${result.range.start.line}:${result.range.start.character}`);
    });
  } else {
    console.log('No results found.');
  }

  languageServer.dispose();
}

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  const clean = args.includes('--clean');
  const argument = args.filter(arg => arg !== '--clean').join(' ');

  if (command === 'index') {
    await index(argument || '.', clean);
  } else if (command === 'search') {
    if (!argument) {
      console.error('Please provide a search query.');
      process.exit(1);
    }
    await search(argument);
  } else if (command === 'references') {
    if (!argument) {
      console.error('Please provide a file path and position, e.g., src/index.ts:10:5');
      process.exit(1);
    }
    const [filePath, line, character] = argument.split(':');
    await references(filePath, parseInt(line, 10), parseInt(character, 10));
  } else {
    console.log('Usage:');
    console.log('  npm run index [directory] [--clean]   - Index a directory, optionally deleting the old index first');
    console.log('  npm run search <query>                - Search for code');
    console.log('  npm run references <path:line:char>   - Find all references for a symbol');
  }
}

main().catch(error => {
  console.error('An error occurred:', error);
  process.exit(1);
});
