import { Command } from 'commander';
import { LanguageServerService } from '../utils/language_server';
import { findProjectRoot } from '../utils/find_project_root';
import path from 'path';

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
    results.forEach((result) => {
      const resultPath = result.uri.replace(`file://${projectRoot}/`, '');
      console.log(`  - ${resultPath}:${result.range.start.line}:${result.range.start.character}`);
    });
  } else {
    console.log('No results found.');
  }

  languageServer.dispose();
}

export const referencesCommand = new Command('references')
  .description('Find all references for a symbol')
  .argument('<path:line:char>', 'The file path and position, e.g., src/index.ts:10:5')
  .action(async (position) => {
    const [filePath, line, character] = position.split(':');
    await references(filePath, parseInt(line, 10), parseInt(character, 10));
  });
