// src/utils/parser.ts
import Parser from 'tree-sitter';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { languageConfigurations } from '../languages';
import { CodeChunk, SymbolInfo } from './elasticsearch';
import { indexingConfig } from '../config';
import { logger } from './logger';

const { Query } = Parser;

/**
 * Extracts directory information from a file path.
 * @param filePath The relative file path
 * @returns Object containing directoryPath, directoryName, and directoryDepth
 */
function extractDirectoryInfo(filePath: string): {
  directoryPath: string;
  directoryName: string;
  directoryDepth: number;
} {
  const dirPath = path.dirname(filePath);
  const dirName = dirPath === '.' ? '' : path.basename(dirPath);

  // Normalize separators to forward slashes for consistent depth calculation
  const normalizedDirPath = dirPath === '.' ? '' : dirPath.replace(/\\/g, '/');
  // Calculate depth by counting forward slashes
  const depth = normalizedDirPath === '' ? 0 : normalizedDirPath.split('/').length;

  return {
    directoryPath: normalizedDirPath,
    directoryName: dirName,
    directoryDepth: depth,
  };
}

export interface LanguageConfiguration {
  name: string;
  fileSuffixes: string[];
  // The tree-sitter language packages (e.g., tree-sitter-typescript) do not share a common, importable type
  // for the language parser object, making it impractical to type this map statically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parser: any; // This can be a tree-sitter parser or null for custom parsers
  queries: string[];
  importQueries?: string[];
  symbolQueries?: string[];
}

export class LanguageParser {
  private languages: Map<string, LanguageConfiguration>;
  public fileSuffixMap: Map<string, LanguageConfiguration>;

  constructor() {
    this.languages = new Map();
    this.fileSuffixMap = new Map();
    const languageNames = (process.env.SEMANTIC_CODE_INDEXER_LANGUAGES || 'typescript,javascript,markdown,yaml,java,go,python,json').split(',');
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
      return this.parseEntireFileAsChunk(filePath, gitBranch, relativePath, langConfig);
    }

    return this.parseWithTreeSitter(filePath, gitBranch, relativePath, langConfig);
  }

  private parseEntireFileAsChunk(filePath: string, gitBranch: string, relativePath: string, langConfig: LanguageConfiguration): CodeChunk[] {
    const now = new Date().toISOString();
    const content = fs.readFileSync(filePath, 'utf8');
    const gitFileHash = execSync(`git hash-object ${filePath}`).toString().trim();

    if (Buffer.byteLength(content, 'utf8') > indexingConfig.maxChunkSizeBytes) {
      logger.warn(`Skipping file ${filePath} because it is larger than maxChunkSizeBytes`);
      return [];
    }

    const endLine = (content.match(/\n/g) || []).length + 1;
    const chunkHash = createHash('sha256').update(content).digest('hex');
    const directoryInfo = extractDirectoryInfo(relativePath);
    
    const baseChunk: Omit<CodeChunk, 'semantic_text' | 'code_vector'> = {
        type: 'doc',
        language: langConfig.name,
        filePath: relativePath,
        ...directoryInfo,
        git_file_hash: gitFileHash,
        git_branch: gitBranch,
        chunk_hash: chunkHash,
        content: content,
        startLine: 1,
        endLine: endLine,
        created_at: now,
        updated_at: now,
    };
    return [{
      ...baseChunk,
      semantic_text: this.prepareSemanticText(baseChunk),
    } as CodeChunk];
  }

  private parseWithTreeSitter(filePath: string, gitBranch: string, relativePath: string, langConfig: LanguageConfiguration): CodeChunk[] {
    const now = new Date().toISOString();
    const parser = new Parser();
    parser.setLanguage(langConfig.parser);

    const sourceCode = fs.readFileSync(filePath, 'utf8');
    const tree = parser.parse(sourceCode);
    const query = new Query(langConfig.parser, langConfig.queries.join('\n'));
    const matches = query.matches(tree.rootNode);
    fs.writeFileSync('matches.json', JSON.stringify(matches, null, 2));
    const gitFileHash = execSync(`git hash-object ${filePath}`).toString().trim();

    const importsByLine: { [line: number]: { path: string; type: 'module' | 'file'; symbols?: string[] }[] } = {};
    if (langConfig.importQueries) {
      const importQuery = new Query(langConfig.parser, langConfig.importQueries.join('\n'));
      const importMatches = importQuery.matches(tree.rootNode);

      for (const match of importMatches) {
        let importPath = '';
        const symbols: string[] = [];
        let pathFound = false;

        for (const capture of match.captures) {
          if (capture.name === 'import.path') {
            importPath = capture.node.text.replace(/['"]/g, '');
            pathFound = true;
          } else if (capture.name === 'import.symbol') {
            symbols.push(capture.node.text);
          }
        }

        // Only create an import object if a path was successfully extracted.
        // This prevents the creation of malformed entries when a query fails to parse a statement.
        if (pathFound && importPath) {
          const line = match.captures[0].node.startPosition.row + 1;
          if (!importsByLine[line]) {
            importsByLine[line] = [];
          }

          let type: 'module' | 'file' = 'module';
          if (importPath.startsWith('.')) {
            const resolvedPath = path.resolve(path.dirname(filePath), importPath);
            const gitRoot = execSync('git rev-parse --show-toplevel', { cwd: path.dirname(filePath) }).toString().trim();
            importPath = path.relative(gitRoot, resolvedPath);
            type = 'file';
          }
          importsByLine[line].push({ path: importPath, type, symbols });
        }
      }
    }

    const symbolsByLine: { [line: number]: SymbolInfo[] } = {};
    if (langConfig.symbolQueries) {
      const symbolQuery = new Query(langConfig.parser, langConfig.symbolQueries.join('\n'));
      const symbolMatches = symbolQuery.matches(tree.rootNode);
      for (const m of symbolMatches) {
        const capture = m.captures[0];
        const kind = capture.name || 'symbol';
        const line = capture.node.startPosition.row + 1;
        if (!symbolsByLine[line]) {
          symbolsByLine[line] = [];
        }
        symbolsByLine[line].push({
          name: capture.node.text,
          kind,
          line,
        });
      }
    }

    const uniqueMatches = Array.from(new Map(matches.map(match => {
      const node = match.captures[0].node;
      const chunkHash = createHash('sha256').update(node.text).digest('hex');
      return [`${node.startIndex}-${node.endIndex}-${chunkHash}`, match];
    })).values());

    return uniqueMatches.map(({ captures }) => {
      const node = captures[0].node;
      const content = node.text;
      if (Buffer.byteLength(content, 'utf8') > indexingConfig.maxChunkSizeBytes) {
        logger.warn(`Skipping chunk in ${filePath} because it is larger than maxChunkSizeBytes`);
        return null;
      }
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

      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const chunkImports = importsByLine[startLine] || [];
      const chunkSymbols: SymbolInfo[] = [];
      for (let i = startLine; i <= endLine; i++) {
        if (symbolsByLine[i]) {
          chunkSymbols.push(...symbolsByLine[i]);
        }
      }
      
      const directoryInfo = extractDirectoryInfo(relativePath);

      const baseChunk: Omit<CodeChunk, 'semantic_text' | 'code_vector'> = {
        type: 'code',
        language: langConfig.name,
        kind: node.type,
        imports: chunkImports,
        symbols: chunkSymbols,
        containerPath,
        filePath: relativePath,
        ...directoryInfo,
        git_file_hash: gitFileHash,
        git_branch: gitBranch,
        chunk_hash: chunkHash,
        startLine,
        endLine,
        content: content,
        created_at: now,
        updated_at: now,
      };

      return {
        ...baseChunk,
        semantic_text: this.prepareSemanticText(baseChunk),
      } as CodeChunk;
    }).filter((chunk): chunk is CodeChunk => chunk !== null);
  }

  private prepareSemanticText(chunk: Omit<CodeChunk, 'semantic_text' | 'code_vector' | 'created_at' | 'updated_at' | 'chunk_hash' | 'git_file_hash'>): string {
    let text = `filePath: ${chunk.filePath}\n`;
    if (chunk.directoryPath) {
      text += `directoryPath: ${chunk.directoryPath}\n`;
    }
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
