
import './config'; // Must be the first import
import { index, references, incrementalIndex, setup, worker, monitorQueue, multiWorker, clearQueue } from './commands';

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  const clean = args.includes('--clean');
  const argument = args.filter(arg => arg !== '--clean').join(' ');

  if (command === 'index') {
    await index(argument || '.', clean);
  } else if (command === 'incremental-index') {
    await incrementalIndex(argument || '.');
  } else if (command === 'references') {
    if (!argument) {
      console.error('Please provide a file path and position, e.g., src/index.ts:10:5');
      process.exit(1);
    }
    const [filePath, line, character] = argument.split(':');
    await references(filePath, parseInt(line, 10), parseInt(character, 10));
  } else if (command === 'setup') {
    if (!argument) {
      console.error('Please provide a repository URL.');
      process.exit(1);
    }
    await setup(argument);
  } else if (command === 'worker') {
    const concurrencyArg = args.find(arg => arg.startsWith('--concurrency='));
    const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 1;
    const watch = args.includes('--watch');
    await worker(concurrency, watch);
  } else if (command === 'multi-index-worker') {
    const concurrencyArg = args.find(arg => arg.startsWith('--concurrency='));
    const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 1;
    const watch = args.includes('--watch');
    const repoNameArg = args.find(arg => arg.startsWith('--repo-name=')) || '';
    const repoName = repoNameArg.split('=')[1] || '';
    await multiWorker(concurrency, watch, repoName);
  } else if (command === 'clear-queue') {
    await clearQueue();
  } else if (command === 'monitor-queue') {
    await monitorQueue();
   } else {
    console.log('Usage:');
    console.log('  npm run setup <repo_url>                   - Clones a repository to be indexed');
    console.log('  npm run index [directory] [--clean]        - Index a directory, optionally deleting the old index first');
    console.log('  npm run index-worker [--concurrency=N] [--watch] - Start a single indexer worker for development');
    console.log('  npm run multi-index-worker -- --repo-name=<repo> - Start a dedicated worker for a specific repository');
    console.log('  npm run clear-queue                          - Deletes all documents from the queue');
    console.log('  npm run monitor-queue                        - Display statistics about the document queue');
    console.log(
      '  npm run incremental-index [directory] [--log-mode] - Incrementally index a directory'
    );
    console.log('  npm run references <path:line:char>        - Find all references for a symbol');
  }
}

main().catch(error => {
  console.error('An error occurred:', error);
  process.exit(1);
});
