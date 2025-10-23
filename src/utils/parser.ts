// src/utils/parser.ts
import Parser from 'tree-sitter';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { languageConfigurations, parseLanguageNames } from '../languages';
import { CodeChunk, SymbolInfo, ExportInfo } from './elasticsearch';
import { indexingConfig } from '../config';
import { logger } from './logger';
import {
  CHUNK_TYPE_CODE,
  CHUNK_TYPE_DOC,
  LANG_MARKDOWN,
  LANG_YAML,
  LANG_JSON,
  LANG_TEXT,
  LANG_GRADLE,
  LANG_HANDLEBARS,
  PARSER_TYPE_MARKDOWN,
  PARSER_TYPE_YAML,
  PARSER_TYPE_JSON,
  PARSER_TYPE_TEXT,
  PARSER_TYPE_HANDLEBARS,
  PARSER_TYPE_TREE_SITTER,
} from './constants';

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

export interface ParseResult {
  chunks: CodeChunk[];
  metrics: {
    filesProcessed: number;
    filesFailed: number;
    chunksCreated: number;
    chunksSkipped: number;
    chunkSizes: number[];
    language: string;
    parserType: string;
  };
}

interface FileMetadata {
  content: string;
  gitFileHash: string;
  timestamp: string;
}

interface ChunkParams {
  content: string;
  language: string;
  relativePath: string;
  gitFileHash: string;
  gitBranch: string;
  startLine: number;
  endLine: number;
  timestamp: string;
}

/**
 * Base structure for parser metric data
 */
const BASE_PARSER_METRIC_DATA: ParseResult['metrics'] = {
  filesProcessed: 0,
  filesFailed: 0,
  chunksCreated: 0,
  chunksSkipped: 0,
  chunkSizes: [],
  language: '',
  parserType: '',
};

export class LanguageParser {
  private languages: Map<string, LanguageConfiguration>;
  public fileSuffixMap: Map<string, LanguageConfiguration>;

  constructor() {
    this.languages = new Map();
    this.fileSuffixMap = new Map();
    const languageNames = parseLanguageNames(process.env.SEMANTIC_CODE_INDEXER_LANGUAGES);
    for (const name of languageNames) {
      const config = languageConfigurations[name];
      this.languages.set(config.name, config);
      for (const suffix of config.fileSuffixes) {
        this.fileSuffixMap.set(suffix, config);
      }
    }
  }

  private getLanguageConfigForFile(filePath: string): LanguageConfiguration | undefined {
    const fileExt = path.extname(filePath);
    return this.fileSuffixMap.get(fileExt);
  }

  /**
   * Reads a file and extracts metadata needed for parsing.
   * @param filePath - Absolute path to the file
   * @returns File content, git hash, and timestamp
   */
  private readFileWithMetadata(filePath: string): FileMetadata {
    return {
      content: fs.readFileSync(filePath, 'utf8'),
      gitFileHash: execSync(`git hash-object ${filePath}`).toString().trim(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Validates that a chunk's size is within the configured maximum.
   * @param content - The chunk content to validate
   * @param filePath - File path for logging purposes
   * @returns true if valid, false if too large
   */
  private validateChunkSize(content: string, filePath: string): boolean {
    const size = Buffer.byteLength(content, 'utf8');
    if (size > indexingConfig.maxChunkSizeBytes) {
      logger.warn(
        `Skipping chunk in ${filePath} because it is larger than maxChunkSizeBytes (${size} > ${indexingConfig.maxChunkSizeBytes})`
      );
      return false;
    }
    return true;
  }

  /**
   * Creates a code chunk with all required metadata.
   * @param params - Parameters for chunk creation
   * @returns Complete CodeChunk object with semantic_text
   */
  private createChunk(params: ChunkParams): CodeChunk {
    const chunkHash = createHash('sha256').update(params.content).digest('hex');
    const directoryInfo = extractDirectoryInfo(params.relativePath);

    const baseChunk: Omit<CodeChunk, 'semantic_text' | 'code_vector'> = {
      type: CHUNK_TYPE_DOC,
      language: params.language,
      filePath: params.relativePath,
      ...directoryInfo,
      git_file_hash: params.gitFileHash,
      git_branch: params.gitBranch,
      chunk_hash: chunkHash,
      content: params.content,
      startLine: params.startLine,
      endLine: params.endLine,
      created_at: params.timestamp,
      updated_at: params.timestamp,
    };

    return {
      ...baseChunk,
      semantic_text: this.prepareSemanticText(baseChunk),
    };
  }

  /**
   * Parses a file as a single whole-file chunk.
   * Used for template files and other documents that benefit from full context.
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @param language - Language identifier
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseWholeFile(
    filePath: string,
    gitBranch: string,
    relativePath: string,
    language: string
  ): { chunks: CodeChunk[]; chunksSkipped: number } {
    const { content, gitFileHash, timestamp } = this.readFileWithMetadata(filePath);

    if (!this.validateChunkSize(content, filePath)) {
      return { chunks: [], chunksSkipped: 1 };
    }

    const lines = content.split('\n');
    const chunk = this.createChunk({
      content,
      language,
      relativePath,
      gitFileHash,
      gitBranch,
      startLine: 1,
      endLine: lines.length,
      timestamp,
    });

    return { chunks: [chunk], chunksSkipped: 0 };
  }

  public parseFile(filePath: string, gitBranch: string, relativePath: string): ParseResult {
    const langConfig = this.getLanguageConfigForFile(filePath);
    if (!langConfig) {
      console.warn(`Unsupported file type: ${path.extname(filePath)}`);
      return {
        chunks: [],
        metrics: { ...BASE_PARSER_METRIC_DATA },
      };
    }

    const metricData = {
      ...BASE_PARSER_METRIC_DATA,
      language: langConfig.name,
    };

    try {
      let chunks: CodeChunk[];

      if (langConfig.parser === null) {
        if (langConfig.name === LANG_MARKDOWN) {
          const result = this.parseMarkdown(filePath, gitBranch, relativePath);
          chunks = result.chunks;
          metricData.chunksSkipped += result.chunksSkipped;
          metricData.parserType = PARSER_TYPE_MARKDOWN;
        } else if (langConfig.name === LANG_YAML) {
          const result = this.parseYaml(filePath, gitBranch, relativePath);
          chunks = result.chunks;
          metricData.chunksSkipped += result.chunksSkipped;
          metricData.parserType = PARSER_TYPE_YAML;
        } else if (langConfig.name === LANG_JSON) {
          const result = this.parseJson(filePath, gitBranch, relativePath);
          chunks = result.chunks;
          metricData.chunksSkipped += result.chunksSkipped;
          metricData.parserType = PARSER_TYPE_JSON;
        } else if (langConfig.name === LANG_HANDLEBARS) {
          const result = this.parseHandlebars(filePath, gitBranch, relativePath);
          chunks = result.chunks;
          metricData.chunksSkipped += result.chunksSkipped;
          metricData.parserType = PARSER_TYPE_HANDLEBARS;
        } else if (langConfig.name === LANG_TEXT || langConfig.name === LANG_GRADLE) {
          const result = this.parseText(filePath, gitBranch, relativePath);
          chunks = result.chunks;
          metricData.chunksSkipped += result.chunksSkipped;
          metricData.parserType = PARSER_TYPE_TEXT;
        } else {
          chunks = [];
        }
      } else {
        const result = this.parseWithTreeSitter(filePath, gitBranch, relativePath, langConfig);
        chunks = result.chunks;
        metricData.chunksSkipped += result.chunksSkipped;
        metricData.parserType = PARSER_TYPE_TREE_SITTER;
      }

      metricData.filesProcessed = 1;
      metricData.chunksCreated = chunks.length;
      metricData.chunkSizes = chunks.map(c => Buffer.byteLength(c.content, 'utf8'));

      return { chunks, metrics: metricData };
    } catch (error) {
      logger.error(`Failed to parse file ${filePath}:`, error instanceof Error ? error : new Error(String(error)));
      metricData.filesFailed = 1;
      throw error;
    }
  }

  /**
   * Parses files by splitting content into paragraph-based chunks.
   * Each chunk represents a logical section separated by double newlines.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @param language - Language name for the chunks
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseParagraphs(filePath: string, gitBranch: string, relativePath: string, language: string): { chunks: CodeChunk[]; chunksSkipped: number } {
    const { content, gitFileHash, timestamp } = this.readFileWithMetadata(filePath);

    const paragraphs = content.split(/\n\s*\n/); // Split by paragraphs
    let searchIndex = 0;
    let chunksSkipped = 0;

    const chunks = paragraphs
      .filter(chunk => {
        if (!this.validateChunkSize(chunk, filePath)) {
          chunksSkipped++;
          return false;
        }
        return /[a-zA-Z0-9]/.test(chunk); // Filter out chunks with no alphanumeric characters
      })
      .map((chunk): CodeChunk => {
        // Calculate line numbers by tracking position in original content
        let chunkStartIndex = content.indexOf(chunk, searchIndex);
        if (chunkStartIndex === -1) {
          chunkStartIndex = content.indexOf(chunk);
        }
        const startLine = (content.substring(0, chunkStartIndex).match(/\n/g) || []).length + 1;
        const endLine = startLine + (chunk.match(/\n/g) || []).length;
        searchIndex = chunkStartIndex + chunk.length;

        return this.createChunk({
          content: chunk,
          language,
          relativePath,
          gitFileHash,
          gitBranch,
          startLine,
          endLine,
          timestamp,
        });
    });

    return { chunks, chunksSkipped };
  }

  /**
   * Parses text files by splitting content into paragraph-based chunks.
   * Each chunk represents a logical section separated by double newlines.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseText(filePath: string, gitBranch: string, relativePath: string): { chunks: CodeChunk[]; chunksSkipped: number } {
    return this.parseParagraphs(filePath, gitBranch, relativePath, LANG_TEXT);
  }

  /**
   * Parses Markdown files by splitting content into paragraph-based chunks.
   * Each chunk represents a logical section separated by double newlines.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseMarkdown(filePath: string, gitBranch: string, relativePath: string): { chunks: CodeChunk[]; chunksSkipped: number } {
    return this.parseParagraphs(filePath, gitBranch, relativePath, LANG_MARKDOWN);
  }

  /**
   * Parses Handlebars files by treating the entire file as a single chunk.
   * This preserves the full template context for better semantic search.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseHandlebars(filePath: string, gitBranch: string, relativePath: string): { chunks: CodeChunk[]; chunksSkipped: number } {
    return this.parseWholeFile(filePath, gitBranch, relativePath, LANG_HANDLEBARS);
  }

  /**
   * Parses YAML files by splitting on document separators (---) and then
   * creating individual chunks for each non-empty line within each document.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseYaml(filePath: string, gitBranch: string, relativePath: string): { chunks: CodeChunk[]; chunksSkipped: number } {
    const { content, gitFileHash, timestamp } = this.readFileWithMetadata(filePath);

    const documents = content.split(/^---/m); // Split by document separator
    const allChunks: CodeChunk[] = [];
    let globalLineNumber = 1;
    let chunksSkipped = 0;

    documents.forEach(doc => {
      if (/[a-zA-Z0-9]/.test(doc)) {
        const lines = doc.trim().split('\n');
        lines.forEach((line, localIndex) => {
          if (line.trim().length > 0) {
            if (!this.validateChunkSize(line, filePath)) {
              chunksSkipped++;
              return;
            }

            // Calculate absolute line number in the original file
            const absoluteLineNumber = globalLineNumber + localIndex;

            allChunks.push(this.createChunk({
              content: line,
              language: LANG_YAML,
              relativePath,
              gitFileHash,
              gitBranch,
              startLine: absoluteLineNumber,
              endLine: absoluteLineNumber,
              timestamp,
            }));
          }
        });
        // Update global line number for next document
        globalLineNumber += lines.length + 1; // +1 for the document separator line
      }
    });
    return { chunks: allChunks, chunksSkipped };
  }

  /**
   * Parses JSON files by creating individual chunks for each key-value pair.
   * Each chunk contains a single property with its value formatted as JSON.
   * Line numbers indicate where each key appears in the original file.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseJson(filePath: string, gitBranch: string, relativePath: string): { chunks: CodeChunk[]; chunksSkipped: number } {
    const { content, gitFileHash, timestamp } = this.readFileWithMetadata(filePath);

    const allChunks: CodeChunk[] = [];
    let chunksSkipped = 0;
    const json = JSON.parse(content);
    let searchIndex = 0;

    for (const key in json) {
      const value = JSON.stringify(json[key], null, 2);
      const chunkContent = `"${key}": ${value}`;
      
      if (!this.validateChunkSize(chunkContent, filePath)) {
        chunksSkipped++;
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

        allChunks.push(this.createChunk({
          content: chunkContent,
          language: LANG_JSON,
          relativePath,
          gitFileHash,
          gitBranch,
          startLine,
          endLine,
          timestamp,
        }));
      }
    }
    return { chunks: allChunks, chunksSkipped };
  }

  private parseWithTreeSitter(filePath: string, gitBranch: string, relativePath: string, langConfig: LanguageConfiguration): { chunks: CodeChunk[]; chunksSkipped: number } {
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

    let chunksSkipped = 0;
    const chunks = uniqueMatches.map(({ captures }): CodeChunk | null => {
      const node = captures[0].node;
      const content = node.text;
      const contentSize = Buffer.byteLength(content, 'utf8');
      if (contentSize > indexingConfig.maxChunkSizeBytes) {
        logger.warn(`Skipping chunk in ${filePath} because it is larger than maxChunkSizeBytes`);
        chunksSkipped++;
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
        type: CHUNK_TYPE_CODE,
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
      };
    }).filter((chunk): chunk is CodeChunk => chunk !== null);

    return { chunks, chunksSkipped };
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
