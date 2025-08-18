import Parser from 'tree-sitter';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { parsers } from './constants';

const { Query } = Parser;

interface CodeChunk {
  filePath: string;
  git_file_hash: string;
  git_branch: string;
  chunk_hash: string;
  startLine: number;
  endLine: number;
  content: string;
  created_at: string;
  updated_at: string;
}

function getParser(fileExt: string): any | undefined {
  return parsers[fileExt];
}

const queries: { [key:string]: string } = {
  '.ts': `
    (import_statement) @import
    (function_declaration) @function
    (lexical_declaration
      (variable_declarator
        value: (arrow_function))) @arrow_function
    (call_expression) @call
    (class_declaration) @class
    (comment) @comment
    (type_alias_declaration) @type
    (interface_declaration) @interface
    (enum_declaration) @enum
  `,
  '.tsx': `
    (import_statement) @import
    (function_declaration) @function
    (lexical_declaration
      (variable_declarator
        value: (arrow_function))) @arrow_function
    (call_expression) @call
    (class_declaration) @class
    (comment) @comment
    (type_alias_declaration) @type
    (interface_declaration) @interface
    (enum_declaration) @enum
  `,
  '.js': `
    (function_declaration) @function
    (lexical_declaration
      (variable_declarator
        value: (arrow_function))) @arrow_function
    (call_expression) @call
    (class_declaration) @class
    (comment) @comment
  `,
};

function getQuery(fileExt: string): string | undefined {
  return queries[fileExt];
}

/**
 * Parses a source code file and extracts code chunks.
 * @param filePath The path to the file to parse.
 * @returns An array of code chunks.
 */
export function parseFile(filePath: string, gitBranch: string, relativePath: string): CodeChunk[] {
  const fileExt = path.extname(filePath);
  const language = getParser(fileExt);
  const queryString = getQuery(fileExt);

  if (!language || !queryString) {
    console.warn(`Unsupported file type: ${fileExt}`);
    return [];
  }

  const parser = new Parser();
  parser.setLanguage(language);

  const sourceCode = fs.readFileSync(filePath, 'utf8');
  const tree = parser.parse(sourceCode);
  const query = new Query(language, queryString);
  const matches = query.matches(tree.rootNode);
  const gitFileHash = execSync(`git hash-object ${filePath}`).toString().trim();
  const now = new Date().toISOString();

  return matches.map(({ captures }) => {
    const node = captures[0].node;
    const content = node.text;
    const chunkHash = createHash('sha256').update(content).digest('hex');
    return {
      filePath: relativePath,
      git_file_hash: gitFileHash,
      git_branch: gitBranch,
      chunk_hash: chunkHash,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      content: content,
      created_at: now,
      updated_at: now,
    };
  });
}
