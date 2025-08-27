// src/utils/parser.ts
import Parser from 'tree-sitter';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { languageConfigurations } from '../languages';
import { CodeChunk } from './elasticsearch';

const { Query } = Parser;

export interface LanguageConfiguration {
  name: string;
  fileSuffixes: string[];
  parser: any; // This can be a tree-sitter parser or null for custom parsers
  queries: string[];
}

export class LanguageParser {
  private languages: Map<string, LanguageConfiguration>;
  public fileSuffixMap: Map<string, LanguageConfiguration>;

  constructor() {
    this.languages = new Map();
    this.fileSuffixMap = new Map();
    const languageNames = (process.env.SEMANTIC_CODE_INDEXER_LANGUAGES || 'typescript,javascript,markdown,yaml').split(',');
    for (const name of languageNames) {
      const config = (languageConfigurations as { [key: string]: LanguageConfiguration })[name.trim()];
      if (config) {
        this.languages.set(config.name, config);
        for (const suffix of config.fileSuffixes) {
          this.fileSuffixMap.set(suffix, config);
        }
      }
    }
  }

  private getLanguageConfigForFile(filePath: string): LanguageConfiguration | undefined {
    const fileExt = path.extname(filePath);
    return this.fileSuffixMap.get(fileExt);
  }

  public parseFile(filePath: string, gitBranch: string, relativePath: string): CodeChunk[] {
    const langConfig = this.getLanguageConfigForFile(filePath);
    if (!langConfig) {
      console.warn(`Unsupported file type: ${path.extname(filePath)}`);
      return [];
    }

    if (langConfig.parser === null) {
      if (langConfig.name === 'markdown') {
        return this.parseMarkdown(filePath, gitBranch, relativePath);
      }
      if (langConfig.name === 'yaml') {
        return this.parseYaml(filePath, gitBranch, relativePath);
      }
    }

    return this.parseWithTreeSitter(filePath, gitBranch, relativePath, langConfig);
  }

  private parseMarkdown(filePath: string, gitBranch: string, relativePath: string): CodeChunk[] {
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
          embedding_text: this.prepareContentForEmbedding(codeChunk),
        }
    });
  }

  private parseYaml(filePath: string, gitBranch: string, relativePath: string): CodeChunk[] {
    const now = new Date().toISOString();
    const content = fs.readFileSync(filePath, 'utf8');
    const documents = content.split(/^---/m); // Split by document separator
    const gitFileHash = execSync(`git hash-object ${filePath}`).toString().trim();
    const allChunks: CodeChunk[] = [];

    documents.forEach(doc => {
      if (/[a-zA-Z0-9]/.test(doc)) {
        const lines = doc.trim().split('\n');
        lines.forEach((line, index) => {
          if (line.trim().length > 0) {
            const chunkHash = createHash('sha256').update(line).digest('hex');
            const codeChunk: Omit<CodeChunk, 'embedding_text'> = {
              type: 'doc',
              language: 'yaml',
              filePath: relativePath,
              git_file_hash: gitFileHash,
              git_branch: gitBranch,
              chunk_hash: chunkHash,
              content: line,
              startLine: index + 1,
              endLine: index + 1,
              created_at: now,
              updated_at: now,
            };
            allChunks.push({
              ...codeChunk,
              embedding_text: this.prepareContentForEmbedding(codeChunk),
            });
          }
        });
      }
    });
    return allChunks;
  }

  private parseWithTreeSitter(filePath: string, gitBranch: string, relativePath: string, langConfig: LanguageConfiguration): CodeChunk[] {
    const now = new Date().toISOString();
    const parser = new Parser();
    parser.setLanguage(langConfig.parser);

    const sourceCode = fs.readFileSync(filePath, 'utf8');
    const tree = parser.parse(sourceCode);
    const query = new Query(langConfig.parser, langConfig.queries.join('\n'));
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
      if (parent) {
        if (parent.type === 'class_body') {
          parent = parent.parent;
        }

        if (parent && (parent.type === 'class_declaration' || parent.type === 'function_declaration' || parent.type === 'class_definition')) {
          const nameNode = parent.namedChildren.find(child => child.type === 'identifier' || child.type === 'type_identifier');
          if (nameNode) {
            containerPath = nameNode.text;
          }
        }
      }

      const chunk: Omit<CodeChunk, 'embedding_text'> = {
        type: 'code',
        language: langConfig.name,
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
        embedding_text: this.prepareContentForEmbedding(chunk),
      };
    });
  }

  private prepareContentForEmbedding(chunk: Omit<CodeChunk, 'embedding_text' | 'created_at' | 'updated_at' | 'chunk_hash' | 'git_file_hash'>): string {
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
}