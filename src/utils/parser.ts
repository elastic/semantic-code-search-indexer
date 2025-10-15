// src/utils/parser.ts
import Parser from 'tree-sitter';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { languageConfigurations } from '../languages';
import { CodeChunk, SymbolInfo, ExportInfo } from './elasticsearch';
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
  exportQueries?: string[];
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
      if (langConfig.name === 'markdown') {
        return this.parseMarkdown(filePath, gitBranch, relativePath);
      }
      if (langConfig.name === 'yaml') {
        return this.parseYaml(filePath, gitBranch, relativePath);
      }
      if (langConfig.name === 'json') {
        return this.parseJson(filePath, gitBranch, relativePath);
      }
      if (langConfig.name === 'text' || langConfig.name === 'gradle') {
        return this.parseText(filePath, gitBranch, relativePath);
      }
    }

    return this.parseWithTreeSitter(filePath, gitBranch, relativePath, langConfig);
  }

  /**
   * Parses files by splitting content into paragraph-based chunks.
   * Each chunk represents a logical section separated by double newlines.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @param language - Language name for the chunks
   * @returns Array of CodeChunk objects
   */
  private parseParagraphs(filePath: string, gitBranch: string, relativePath: string, language: string): CodeChunk[] {
    const now = new Date().toISOString();
    let content: string;
    let gitFileHash: string;

    try {
      content = fs.readFileSync(filePath, 'utf8');
      gitFileHash = execSync(`git hash-object ${filePath}`).toString().trim();
    } catch (error) {
      logger.error(`Failed to read file ${filePath}:`, error instanceof Error ? error : new Error(String(error)));
      return [];
    }

    const chunks = content.split(/\n\s*\n/); // Split by paragraphs
    let searchIndex = 0;

    return chunks
      .filter(chunk => {
        if (Buffer.byteLength(chunk, 'utf8') > indexingConfig.maxChunkSizeBytes) {
          logger.warn(`Skipping chunk in ${filePath} because it is larger than maxChunkSizeBytes`);
          return false;
        }
        return /[a-zA-Z0-9]/.test(chunk); // Filter out chunks with no alphanumeric characters
      })
      .map(chunk => {
        // Calculate line numbers by tracking position in original content
        let chunkStartIndex = content.indexOf(chunk, searchIndex);
        if (chunkStartIndex === -1) {
          chunkStartIndex = content.indexOf(chunk);
        }
        const startLine = (content.substring(0, chunkStartIndex).match(/\n/g) || []).length + 1;
        const endLine = startLine + (chunk.match(/\n/g) || []).length;
        searchIndex = chunkStartIndex + chunk.length;

        const chunkHash = createHash('sha256').update(chunk).digest('hex');
        const directoryInfo = extractDirectoryInfo(relativePath);

        const baseChunk: Omit<CodeChunk, 'semantic_text' | 'code_vector'> = {
            type: 'doc',
            language,
            filePath: relativePath,
            ...directoryInfo,
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
          ...baseChunk,
          semantic_text: this.prepareSemanticText(baseChunk),
        } as CodeChunk;
    });
  }

  /**
   * Parses text files by splitting content into paragraph-based chunks.
   * Each chunk represents a logical section separated by double newlines.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Array of CodeChunk objects
   */
  private parseText(filePath: string, gitBranch: string, relativePath: string): CodeChunk[] {
    return this.parseParagraphs(filePath, gitBranch, relativePath, 'text');
  }

  /**
   * Parses Markdown files by splitting content into paragraph-based chunks.
   * Each chunk represents a logical section separated by double newlines.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Array of CodeChunk objects
   */
  private parseMarkdown(filePath: string, gitBranch: string, relativePath: string): CodeChunk[] {
    return this.parseParagraphs(filePath, gitBranch, relativePath, 'markdown');
  }

  /**
   * Parses YAML files by splitting on document separators (---) and then
   * creating individual chunks for each non-empty line within each document.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Array of CodeChunk objects
   */
  private parseYaml(filePath: string, gitBranch: string, relativePath: string): CodeChunk[] {
    const now = new Date().toISOString();
    let content: string;
    let gitFileHash: string;

    try {
      content = fs.readFileSync(filePath, 'utf8');
      gitFileHash = execSync(`git hash-object ${filePath}`).toString().trim();
    } catch (error) {
      logger.error(`Failed to read file ${filePath}:`, error instanceof Error ? error : new Error(String(error)));
      return [];
    }

    const documents = content.split(/^---/m); // Split by document separator
    const allChunks: CodeChunk[] = [];
    let globalLineNumber = 1;

    documents.forEach(doc => {
      if (/[a-zA-Z0-9]/.test(doc)) {
        const lines = doc.trim().split('\n');
        lines.forEach((line, localIndex) => {
          if (line.trim().length > 0) {
            if (Buffer.byteLength(line, 'utf8') > indexingConfig.maxChunkSizeBytes) {
              logger.warn(`Skipping chunk in ${filePath} because it is larger than maxChunkSizeBytes`);
              return;
            }

            // Calculate absolute line number in the original file
            const absoluteLineNumber = globalLineNumber + localIndex;

            const chunkHash = createHash('sha256').update(line).digest('hex');
            const directoryInfo = extractDirectoryInfo(relativePath);

            const baseChunk: Omit<CodeChunk, 'semantic_text' | 'code_vector'> = {
              type: 'doc',
              language: 'yaml',
              filePath: relativePath,
              ...directoryInfo,
              git_file_hash: gitFileHash,
              git_branch: gitBranch,
              chunk_hash: chunkHash,
              content: line,
              startLine: absoluteLineNumber,
              endLine: absoluteLineNumber,
              created_at: now,
              updated_at: now,
            };
            allChunks.push({
              ...baseChunk,
              semantic_text: this.prepareSemanticText(baseChunk),
            } as CodeChunk);
          }
        });
        // Update global line number for next document
        globalLineNumber += lines.length + 1; // +1 for the document separator line
      }
    });
    return allChunks;
  }

  /**
   * Parses JSON files by creating individual chunks for each key-value pair.
   * Each chunk contains a single property with its value formatted as JSON.
   * Line numbers indicate where each key appears in the original file.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Array of CodeChunk objects
   */
  private parseJson(filePath: string, gitBranch: string, relativePath: string): CodeChunk[] {
    const now = new Date().toISOString();
    let content: string;
    let gitFileHash: string;

    try {
      content = fs.readFileSync(filePath, 'utf8');
      gitFileHash = execSync(`git hash-object ${filePath}`).toString().trim();
    } catch (error) {
      logger.error(`Failed to read file ${filePath}:`, error instanceof Error ? error : new Error(String(error)));
      return [];
    }

    const allChunks: CodeChunk[] = [];
    try {
      const json = JSON.parse(content);
      let searchIndex = 0;
      
      for (const key in json) {
        const value = JSON.stringify(json[key], null, 2);
        const chunkContent = `"${key}": ${value}`;
        if (Buffer.byteLength(chunkContent, 'utf8') > indexingConfig.maxChunkSizeBytes) {
          logger.warn(`Skipping chunk in ${filePath} because it is larger than maxChunkSizeBytes`);
          continue;
        }

        // Find the position of this key in the original content
        // Search for the key with quotes and colon to get accurate position
        const keyPattern = `"${key}"`;
        const keyPosition = content.indexOf(keyPattern, searchIndex);
        
        if (keyPosition !== -1) {
          // Calculate line number based on position
          const startLine = (content.substring(0, keyPosition).match(/\n/g) || []).length + 1;
          
          // Find the end of this key's value in the original content
          // This is an approximation - we'll use the number of newlines in the formatted value
          const valueLines = value.split('\n').length;
          const endLine = startLine + valueLines - 1;
          
          // Update search index to after this key
          searchIndex = keyPosition + keyPattern.length;

          const chunkHash = createHash('sha256').update(chunkContent).digest('hex');
          const directoryInfo = extractDirectoryInfo(relativePath);

          const baseChunk: Omit<CodeChunk, 'semantic_text' | 'code_vector'> = {
            type: 'doc',
            language: 'json',
            filePath: relativePath,
            ...directoryInfo,
            git_file_hash: gitFileHash,
            git_branch: gitBranch,
            chunk_hash: chunkHash,
            content: chunkContent,
            startLine,
            endLine,
            created_at: now,
            updated_at: now,
          };
          allChunks.push({
            ...baseChunk,
            semantic_text: this.prepareSemanticText(baseChunk),
          } as CodeChunk);
        }
      }
    } catch (error) {
      logger.error(`Failed to parse JSON file: ${filePath}`, error instanceof Error ? error : new Error(String(error)));
    }
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

    // Tree-sitter capture names for imports and exports
    const IMPORT_CAPTURE_NAMES = {
      PATH: 'import.path',
      SYMBOL: 'import.symbol',
    } as const;

    const EXPORT_CAPTURE_NAMES = {
      NAME: 'export.name',
      DEFAULT: 'export.default',
      NAMESPACE: 'export.namespace',
      SOURCE: 'export.source',
    } as const;

    const importsByLine: { [line: number]: { path: string; type: 'module' | 'file'; symbols?: string[] }[] } = {};
    if (langConfig.importQueries) {
      const importQuery = new Query(langConfig.parser, langConfig.importQueries.join('\n'));
      const importMatches = importQuery.matches(tree.rootNode);

      for (const match of importMatches) {
        let importPath = '';
        const symbols: string[] = [];
        let pathFound = false;

        for (const capture of match.captures) {
          if (capture.name === IMPORT_CAPTURE_NAMES.PATH) {
            importPath = capture.node.text.replace(/['"]/g, '');
            pathFound = true;
          } else if (capture.name === IMPORT_CAPTURE_NAMES.SYMBOL) {
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

    const exportsByLine: { [line: number]: ExportInfo[] } = {};
    if (langConfig.exportQueries) {
      const exportQuery = new Query(langConfig.parser, langConfig.exportQueries.join('\n'));
      const exportMatches = exportQuery.matches(tree.rootNode);

      for (const match of exportMatches) {
        let exportName = '';
        let exportType: 'named' | 'default' | 'namespace' = 'named';
        let exportTarget: string | undefined = undefined;

        for (const capture of match.captures) {
          if (capture.name === EXPORT_CAPTURE_NAMES.NAME) {
            exportName = capture.node.text;
          } else if (capture.name === EXPORT_CAPTURE_NAMES.DEFAULT) {
            exportType = 'default';
            // For default exports like "export default MyClass", traverse AST to find the identifier being exported
            const parent = capture.node.parent;
            if (parent) {
              const identifierNode = parent.children.find(child => child.type === 'identifier' || child.type === 'type_identifier');
              if (identifierNode) {
                exportName = identifierNode.text;
              }
            }
          } else if (capture.name === EXPORT_CAPTURE_NAMES.NAMESPACE) {
            exportType = 'namespace';
            exportName = '*';
          } else if (capture.name === EXPORT_CAPTURE_NAMES.SOURCE) {
            exportTarget = capture.node.text.replace(/['"]/g, '');
            // Resolve relative paths
            if (exportTarget.startsWith('.')) {
              try {
                const resolvedPath = path.resolve(path.dirname(filePath), exportTarget);
                const gitRoot = execSync('git rev-parse --show-toplevel', { cwd: path.dirname(filePath) }).toString().trim();
                exportTarget = path.relative(gitRoot, resolvedPath);
              } catch (error) {
                logger.warn(`Failed to resolve re-export path: ${exportTarget}`, error instanceof Error ? error : new Error(String(error)));
                // Keep the original relative path
              }
            }
          }
        }

        if (exportName || exportType === 'namespace') {
          const line = match.captures[0].node.startPosition.row + 1;
          if (!exportsByLine[line]) {
            exportsByLine[line] = [];
          }
          exportsByLine[line].push({
            name: exportName,
            type: exportType,
            ...(exportTarget && { target: exportTarget }),
          });
        }
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
      const chunkExports = exportsByLine[startLine] || [];

      const directoryInfo = extractDirectoryInfo(relativePath);

      const baseChunk: Omit<CodeChunk, 'semantic_text' | 'code_vector'> = {
        type: 'code',
        language: langConfig.name,
        kind: node.type,
        imports: chunkImports,
        symbols: chunkSymbols,
        exports: chunkExports,
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
