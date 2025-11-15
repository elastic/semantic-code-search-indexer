import { Command } from 'commander';
import { LanguageParser } from '../utils/parser';
import * as fs from 'fs';
import * as path from 'path';
import Parser from 'tree-sitter';

export const dumpTreeCommand = new Command('dump-tree')
  .description('Dump the tree-sitter syntax tree for a given file.')
  .argument('<file>', 'The path to the file to parse.')
  .action(async (filePath) => {
    try {
      const absolutePath = path.resolve(filePath);
      if (!fs.existsSync(absolutePath)) {
        console.error(`File not found: ${absolutePath}`);
        process.exit(1);
      }

      const fileContent = fs.readFileSync(absolutePath, 'utf-8');
      const fileExtension = path.extname(absolutePath);

      const languageParser = new LanguageParser();
      const langConfig = languageParser.fileSuffixMap.get(fileExtension);

      if (!langConfig || !langConfig.parser) {
        console.error(`No parser found for file extension: ${fileExtension}`);
        process.exit(1);
      }

      const parser = new Parser();
      parser.setLanguage(langConfig.parser);

      const tree = parser.parse(fileContent);
      console.log(tree.rootNode.toString());
    } catch (error) {
      console.error('An error occurred:', error);
      process.exit(1);
    }
  });
