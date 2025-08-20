import Parser from 'tree-sitter';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { parsers } from './constants';
import { CodeChunk } from './elasticsearch';

const { Query } = Parser;

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

function getLanguage(fileExt: string): string {
    switch (fileExt) {
        case '.ts':
        case '.tsx':
            return 'typescript';
        case '.js':
        case '.jsx':
            return 'javascript';
        case '.md':
        case '.mdx':
            return 'markdown';
        default:
            return 'unknown';
    }
}

function parseMarkdown(filePath: string, gitBranch: string, relativePath: string): CodeChunk[] {
    const now = new Date().toISOString();
    const content = fs.readFileSync(filePath, 'utf8');
    const chunks = content.split(/\n\s*\n/); // Split by paragraphs
    const gitFileHash = execSync(`git hash-object ${filePath}`).toString().trim();

    return chunks
      .filter(chunk => /[a-zA-Z0-9]/.test(chunk)) // Filter out chunks with no alphanumeric characters
      .map((chunk, index) => {
        const startLine = (content.substring(0, content.indexOf(chunk)).match(/\n/g) || []).length + 1;
        const endLine = startLine + (chunk.match(/\n/g) || []).length;
        const chunkHash = createHash('sha256').update(chunk).digest('hex');
        const codeChunk: Omit<CodeChunk, 'embedding_text'> = {
            type: 'doc',
            language: 'markdown',
            filePath: relativePath,
            git_file_hash: gitFileHash,
            git_branch: gitBranch,
            chunk_hash: chunkHash,
            content: chunk,
            startLine,
            endLine,
            created_at: now,
            updated_at: now,
        };
        return {
          ...codeChunk,
          embedding_text: prepareContentForEmbedding(codeChunk),
        }
    });
}

function prepareContentForEmbedding(chunk: Omit<CodeChunk, 'embedding_text' | 'created_at' | 'updated_at' | 'chunk_hash' | 'git_file_hash'>): string {
  let text = `filePath: ${chunk.filePath}\n`;
  if (chunk.kind) {
    text += `kind: ${chunk.kind}\n`;
  }
  if (chunk.containerPath) {
    text += `containerPath: ${chunk.containerPath}\n`;
  }
  text += `\n${chunk.content}`;
  return text;
}

export function parseFile(filePath: string, gitBranch: string, relativePath: string): CodeChunk[] {
  const fileExt = path.extname(filePath);
  const now = new Date().toISOString();

  if (fileExt === '.md' || fileExt === '.mdx') {
      return parseMarkdown(filePath, gitBranch, relativePath);
  }

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

  const importNodes = matches.filter(
    m => m.captures.some(c => c.name === 'import')
  );
  const imports = importNodes.map(m => m.captures[0].node.text);

  return matches.map(({ captures }) => {
    const node = captures[0].node;
    const content = node.text;
    const chunkHash = createHash('sha256').update(content).digest('hex');

    let containerPath = '';
    let parent = node.parent;
    while (parent) {
      if (parent.type === 'function_declaration' || parent.type === 'class_declaration' || parent.type === 'method_definition') {
        const nameNode = parent.namedChildren.find(child => child.type === 'identifier');
        if (nameNode) {
          containerPath = `${nameNode.text} > ${containerPath}`;
        }
      }
      parent = parent.parent;
    }
    containerPath = containerPath.replace(/ > $/, '');

    const chunk: Omit<CodeChunk, 'embedding_text'> = {
      type: 'code',
      language: getLanguage(fileExt),
      kind: node.type,
      imports,
      containerPath,
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

    return {
      ...chunk,
      embedding_text: prepareContentForEmbedding(chunk),
    };
  });
}