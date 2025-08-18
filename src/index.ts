
import './config'; // Must be the first import
import { index, search, references, incrementalIndex } from './commands';

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  const clean = args.includes('--clean');
  const argument = args.filter(arg => arg !== '--clean').join(' ');

  if (command === 'index') {
    await index(argument || '.', clean);
  } else if (command === 'incremental-index') {
    await incrementalIndex(argument || '.');
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
    console.log('  npm run index [directory] [--clean]        - Index a directory, optionally deleting the old index first');
    console.log('  npm run incremental-index [directory]      - Incrementally index a directory');
    console.log('  npm run search <query>                     - Search for code');
    console.log('  npm run references <path:line:char>        - Find all references for a symbol');
  }
}

main().catch(error => {
  console.error('An error occurred:', error);
  process.exit(1);
});
