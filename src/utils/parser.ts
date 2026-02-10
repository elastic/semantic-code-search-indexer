// src/utils/parser.ts
import Parser from 'tree-sitter';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
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
  LANG_SQL,
  PARSER_TYPE_MARKDOWN,
  PARSER_TYPE_YAML,
  PARSER_TYPE_JSON,
  PARSER_TYPE_TEXT,
  PARSER_TYPE_HANDLEBARS,
  PARSER_TYPE_SQL,
  PARSER_TYPE_TREE_SITTER,
} from './constants';

const { Query } = Parser;

function getGitRoot(cwd: string): string {
  // When running inside git hooks (e.g. husky), git may set GIT_DIR/GIT_WORK_TREE
  // in the environment for child processes. That can cause `git rev-parse --show-toplevel`
  // to incorrectly treat `cwd` as the worktree root.
  //
  // We explicitly remove those env vars so git discovers the real repository root from `cwd`.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;

  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, env }).toString().trim();
}

/**
 * Creates a stable identifier for a chunk's content.
 *
 * NOTE: This hash is stored as `chunk_hash` on the document, but it is not necessarily the
 * Elasticsearch `_id`. The actual `_id` is produced in `src/utils/elasticsearch.ts` (see
 * `getChunkDocumentId`) and may intentionally deduplicate identical content across files.
 */
function createChunkHash(params: {
  type: string;
  language: string;
  relativePath: string;
  gitBranch: string;
  gitFileHash: string;
  startLine: number;
  endLine: number;
  startIndex: number;
  endIndex: number;
  content: string; // Added content param
}): string {
  // IMPORTANT: To implement path aggregation (#121), we MUST NOT include file-specific metadata
  // (path, branch, line numbers) in the hash. Identical code in different files
  // must generate the same hash so they map to the same document.
  const stableId = [
    params.type,
    params.language,
    // params.relativePath, // Excluded for aggregation
    // params.gitBranch,    // Excluded for aggregation
    // params.gitFileHash,  // Excluded for aggregation
    // params.startLine,    // Excluded for aggregation
    // params.endLine,      // Excluded for aggregation
    params.content,
  ].join(':');

  return createHash('sha256').update(stableId).digest('hex');
}

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
  startIndex: number;
  endIndex: number;
  timestamp: string;
}

/**
 * Represents a dependency extracted from SQL content.
 * Used for dbt ref(), source(), macro calls, and table references.
 */
interface SqlDependency {
  type: 'ref' | 'source' | 'macro' | 'table';
  name: string;
  schema?: string;
  line: number;
}

/**
 * Represents a parsed SQL structure (CTE, statement, macro, config).
 */
interface SqlChunkInfo {
  content: string;
  type: string;
  name?: string;
  startLine: number;
  endLine: number;
  dependencies: SqlDependency[];
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
        // Check for duplicate file suffix during map creation
        const existing = this.fileSuffixMap.get(suffix);
        if (existing) {
          logger.warn(
            `File extension "${suffix}" is registered to both "${existing.name}" and "${config.name}". ` +
              `Using "${config.name}".`
          );
        }
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
      // Use execFileSync to prevent shell injection from special characters in file paths
      gitFileHash: execFileSync('git', ['hash-object', filePath]).toString().trim(),
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
    const chunkHash = createChunkHash({
      type: CHUNK_TYPE_DOC,
      language: params.language,
      relativePath: params.relativePath,
      gitBranch: params.gitBranch,
      gitFileHash: params.gitFileHash,
      startLine: params.startLine,
      endLine: params.endLine,
      startIndex: params.startIndex,
      endIndex: params.endIndex,
      content: params.content,
    });
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
      startIndex: 0,
      endIndex: content.length,
      timestamp,
    });

    return { chunks: [chunk], chunksSkipped: 0 };
  }

  /**
   * Parses files by splitting content into fixed-size line-based chunks with overlap.
   * Uses a sliding window approach to create predictable, manageable chunks.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @param language - Language name for the chunks
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseByLines(
    filePath: string,
    gitBranch: string,
    relativePath: string,
    language: string
  ): { chunks: CodeChunk[]; chunksSkipped: number } {
    const { content, gitFileHash, timestamp } = this.readFileWithMetadata(filePath);

    const lines = content.split('\n');
    const CHUNK_SIZE = indexingConfig.defaultChunkLines;
    const OVERLAP = indexingConfig.chunkOverlapLines;
    const STEP = Math.max(1, CHUNK_SIZE - OVERLAP); // Prevent negative or zero steps

    const chunks: CodeChunk[] = [];
    let chunksSkipped = 0;

    for (let i = 0; i < lines.length; i += STEP) {
      const chunkLines = lines.slice(i, i + CHUNK_SIZE);
      const chunkContent = chunkLines.join('\n');

      if (!this.validateChunkSize(chunkContent, filePath)) {
        chunksSkipped++;
        continue;
      }

      const startLine = i + 1;
      const endLine = i + chunkLines.length;
      const startIndex = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
      const endIndex = startIndex + chunkContent.length;

      chunks.push(
        this.createChunk({
          content: chunkContent,
          language,
          relativePath,
          gitFileHash,
          gitBranch,
          startLine,
          endLine,
          startIndex,
          endIndex,
          timestamp,
        })
      );
    }

    return { chunks, chunksSkipped };
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
        } else if (langConfig.name === LANG_SQL) {
          const result = this.parseSql(filePath, gitBranch, relativePath);
          chunks = result.chunks;
          metricData.chunksSkipped += result.chunksSkipped;
          metricData.parserType = PARSER_TYPE_SQL;
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
      metricData.chunkSizes = chunks.map((c) => Buffer.byteLength(c.content, 'utf8'));

      return { chunks, metrics: metricData };
    } catch (error) {
      logger.error(`Failed to parse file ${filePath}:`, error instanceof Error ? error : new Error(String(error)));
      metricData.filesFailed = 1;
      throw error;
    }
  }

  /**
   * Parses files by splitting content into chunks based on a delimiter pattern.
   * Each chunk represents a logical section separated by the delimiter.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @param language - Language name for the chunks
   * @param delimiter - Regular expression pattern to split content (default: paragraph delimiter)
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseParagraphs(
    filePath: string,
    gitBranch: string,
    relativePath: string,
    language: string,
    delimiter: string = '\\n\\s*\\n'
  ): { chunks: CodeChunk[]; chunksSkipped: number } {
    const { content, gitFileHash, timestamp } = this.readFileWithMetadata(filePath);

    // Convert delimiter string to RegExp
    const delimiterRegex = new RegExp(delimiter);
    const paragraphs = content.split(delimiterRegex);
    let searchIndex = 0;
    let chunksSkipped = 0;

    const chunks = paragraphs
      .filter((chunk) => {
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
          startIndex: chunkStartIndex,
          endIndex: chunkStartIndex + chunk.length,
          timestamp,
        });
      });

    return { chunks, chunksSkipped };
  }

  /**
   * Parses text files by splitting content into paragraph-based chunks.
   * Falls back to line-based chunking if no paragraphs are found.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseText(
    filePath: string,
    gitBranch: string,
    relativePath: string
  ): { chunks: CodeChunk[]; chunksSkipped: number } {
    const { content } = this.readFileWithMetadata(filePath);

    // Check if file has paragraph structure
    const hasParagraphs = /\n\s*\n/.test(content);

    if (hasParagraphs) {
      const result = this.parseParagraphs(filePath, gitBranch, relativePath, LANG_TEXT);
      // If paragraphs produced valid chunks, use them
      if (result.chunks.length > 0) {
        return result;
      }
    }

    // Fallback to line-based
    return this.parseByLines(filePath, gitBranch, relativePath, LANG_TEXT);
  }

  /**
   * Parses Markdown files by splitting content into chunks based on configured delimiter.
   * Each chunk represents a logical section separated by the delimiter.
   * The delimiter can be configured via MARKDOWN_CHUNK_DELIMITER environment variable.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseMarkdown(
    filePath: string,
    gitBranch: string,
    relativePath: string
  ): { chunks: CodeChunk[]; chunksSkipped: number } {
    return this.parseParagraphs(
      filePath,
      gitBranch,
      relativePath,
      LANG_MARKDOWN,
      indexingConfig.markdownChunkDelimiter
    );
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
  private parseHandlebars(
    filePath: string,
    gitBranch: string,
    relativePath: string
  ): { chunks: CodeChunk[]; chunksSkipped: number } {
    return this.parseWholeFile(filePath, gitBranch, relativePath, LANG_HANDLEBARS);
  }

  /**
   * Parses YAML files by creating fixed-size line-based chunks with overlap.
   * This provides more context than single-line chunks while maintaining manageable size.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseYaml(
    filePath: string,
    gitBranch: string,
    relativePath: string
  ): { chunks: CodeChunk[]; chunksSkipped: number } {
    return this.parseByLines(filePath, gitBranch, relativePath, LANG_YAML);
  }

  /**
   * Parses JSON files by creating fixed-size line-based chunks with overlap.
   * This prevents large JSON values from creating oversized chunks.
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseJson(
    filePath: string,
    gitBranch: string,
    relativePath: string
  ): { chunks: CodeChunk[]; chunksSkipped: number } {
    return this.parseByLines(filePath, gitBranch, relativePath, LANG_JSON);
  }

  /**
   * Parses SQL files with dbt/Jinja awareness.
   * Extracts CTEs, statements, macros, and dependencies including:
   * - dbt ref() references
   * - dbt source() references
   * - Macro calls
   * - Standard SQL table references from FROM/JOIN clauses
   *
   * @param filePath - Absolute path to the file
   * @param gitBranch - Git branch name
   * @param relativePath - Relative path from repository root
   * @returns Object with chunks array and chunksSkipped count
   */
  private parseSql(
    filePath: string,
    gitBranch: string,
    relativePath: string
  ): { chunks: CodeChunk[]; chunksSkipped: number } {
    const { content, gitFileHash, timestamp } = this.readFileWithMetadata(filePath);

    const chunks: CodeChunk[] = [];
    let chunksSkipped = 0;

    // Extract dependencies from the entire file
    const dependencies = this.extractSqlDependencies(content);

    // Check if this is a dbt macro file
    const macroBlocks = this.extractDbtMacros(content);
    if (macroBlocks.length > 0) {
      // Parse as macro file - create a chunk per macro
      for (const macro of macroBlocks) {
        if (!this.validateChunkSize(macro.content, filePath)) {
          chunksSkipped++;
          continue;
        }

        const chunk = this.createSqlChunk({
          content: macro.content,
          relativePath,
          gitFileHash,
          gitBranch,
          startLine: macro.startLine,
          endLine: macro.endLine,
          timestamp,
          kind: 'macro',
          name: macro.name,
          dependencies: macro.dependencies,
        });
        chunks.push(chunk);
      }

      return { chunks, chunksSkipped };
    }

    // For model/query files, extract SQL structures
    const sqlChunks = this.extractSqlStructures(content, dependencies);

    if (sqlChunks.length === 0) {
      // Fallback: treat as whole file if no structures detected
      if (!this.validateChunkSize(content, filePath)) {
        return { chunks: [], chunksSkipped: 1 };
      }

      const lines = content.split('\n');
      const chunk = this.createSqlChunk({
        content,
        relativePath,
        gitFileHash,
        gitBranch,
        startLine: 1,
        endLine: lines.length,
        timestamp,
        kind: 'statement',
        dependencies,
      });
      return { chunks: [chunk], chunksSkipped: 0 };
    }

    // Create chunks from extracted structures
    for (const sqlChunk of sqlChunks) {
      if (!this.validateChunkSize(sqlChunk.content, filePath)) {
        chunksSkipped++;
        continue;
      }

      chunks.push(
        this.createSqlChunk({
          content: sqlChunk.content,
          relativePath,
          gitFileHash,
          gitBranch,
          startLine: sqlChunk.startLine,
          endLine: sqlChunk.endLine,
          timestamp,
          kind: sqlChunk.type,
          name: sqlChunk.name,
          dependencies: sqlChunk.dependencies,
        })
      );
    }

    return { chunks, chunksSkipped };
  }

  /**
   * Extracts dbt/Jinja dependencies from SQL content.
   * Handles ref(), source(), macro calls, and table references.
   *
   * @param content - The SQL file content
   * @returns Array of SqlDependency objects
   */
  private extractSqlDependencies(content: string): SqlDependency[] {
    const dependencies: SqlDependency[] = [];
    const lines = content.split('\n');

    // Pattern for {{ ref('model_name') }} or {{ ref("model_name") }}
    const refPattern = /\{\{\s*ref\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;

    // Pattern for {{ source('source_name', 'table_name') }}
    const sourcePattern = /\{\{\s*source\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;

    // Pattern for {{ macro_name(...) }} - excluding built-in functions
    const macroPattern = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
    const builtinMacros = new Set([
      'ref',
      'source',
      'config',
      'this',
      'var',
      'env_var',
      'target',
      'adapter',
      'return',
      'log',
      'exceptions',
      'run_query',
      'statement',
      'set',
      'do',
      'if',
      'for',
      'elif',
      'else',
      'endif',
      'endfor',
      'macro',
      'endmacro',
      'call',
      'block',
      'filter',
    ]);

    // Pattern for FROM/JOIN table references (handles schema.table)
    // Excludes Jinja expressions that start with {{
    const tablePattern = /\b(?:FROM|JOIN)\s+(?!\{\{)([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\b/gi;

    lines.forEach((line, index) => {
      const lineNum = index + 1;

      // Extract refs
      let match;
      while ((match = refPattern.exec(line)) !== null) {
        dependencies.push({
          type: 'ref',
          name: match[1],
          line: lineNum,
        });
      }
      refPattern.lastIndex = 0;

      // Extract sources
      while ((match = sourcePattern.exec(line)) !== null) {
        dependencies.push({
          type: 'source',
          schema: match[1],
          name: match[2],
          line: lineNum,
        });
      }
      sourcePattern.lastIndex = 0;

      // Extract macro calls
      while ((match = macroPattern.exec(line)) !== null) {
        if (!builtinMacros.has(match[1].toLowerCase())) {
          dependencies.push({
            type: 'macro',
            name: match[1],
            line: lineNum,
          });
        }
      }
      macroPattern.lastIndex = 0;

      // Extract table references (only non-Jinja ones)
      while ((match = tablePattern.exec(line)) !== null) {
        if (match[1]) {
          const parts = match[1].split('.');
          dependencies.push({
            type: 'table',
            name: parts[parts.length - 1],
            schema: parts.length > 1 ? parts[0] : undefined,
            line: lineNum,
          });
        }
      }
      tablePattern.lastIndex = 0;
    });

    return dependencies;
  }

  /**
   * Extracts SQL structures (CTEs, statements) from content.
   * Handles WITH clauses, SELECT/INSERT/UPDATE/DELETE, CREATE statements.
   *
   * @param content - The SQL file content
   * @param allDependencies - All dependencies extracted from the file
   * @returns Array of SqlChunkInfo objects
   */
  private extractSqlStructures(content: string, allDependencies: SqlDependency[]): SqlChunkInfo[] {
    const chunks: SqlChunkInfo[] = [];
    const lines = content.split('\n');

    // Pattern to detect CTE definitions: name AS (
    const ctePattern = /^\s*,?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+[Aa][Ss]\s*\(/;

    // Pattern to detect main query start (end of WITH clause)
    const mainQueryPattern = /^\s*(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i;

    // Pattern to detect CREATE statements
    const createPattern =
      /^\s*CREATE\s+(OR\s+REPLACE\s+)?(TABLE|VIEW|FUNCTION|PROCEDURE|MATERIALIZED\s+VIEW|SCHEMA|INDEX)/i;

    // Pattern to detect WITH clause start
    const withPattern = /^\s*WITH\b/i;

    // Pattern to detect dbt config block
    const configPattern = /\{\{\s*config\s*\(/;

    // Track parsing state
    let inWith = false;
    let currentCte: { name: string; startLine: number; content: string[]; parenDepth: number } | null = null;
    let mainStatementStart: number | null = null;
    let mainStatementContent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Skip empty lines and comments at the start
      if (mainStatementStart === null && !inWith && /^\s*(--|\/\*|\s*$)/.test(line)) {
        continue;
      }

      // Check for WITH clause start
      if (withPattern.test(line) && !inWith) {
        inWith = true;

        // Check if CTE name is on the same line (e.g., "WITH source AS (")
        const afterWith = line.replace(/^\s*WITH\s*/i, '');
        const cteMatch = afterWith.match(ctePattern);
        if (cteMatch) {
          currentCte = {
            name: cteMatch[1],
            startLine: lineNum,
            content: [line],
            parenDepth: (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length,
          };
        }
        continue;
      }

      // Process CTEs
      if (inWith) {
        // Check for new CTE
        if (!currentCte) {
          const cteMatch = line.match(ctePattern);
          if (cteMatch) {
            currentCte = {
              name: cteMatch[1],
              startLine: lineNum,
              content: [line],
              parenDepth: (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length,
            };
            continue;
          }
        }

        // Track current CTE
        if (currentCte) {
          currentCte.content.push(line);
          currentCte.parenDepth += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;

          // CTE ends when parentheses balance
          if (currentCte.parenDepth <= 0) {
            const cteContent = currentCte.content.join('\n');
            const cteDeps = allDependencies.filter((d) => d.line >= currentCte!.startLine && d.line <= lineNum);

            chunks.push({
              content: cteContent,
              type: 'cte',
              name: currentCte.name,
              startLine: currentCte.startLine,
              endLine: lineNum,
              dependencies: cteDeps,
            });

            currentCte = null;
          }
          continue;
        }

        // Check for main query start (end of WITH clause)
        if (mainQueryPattern.test(line)) {
          inWith = false;
          mainStatementStart = lineNum;
          mainStatementContent = [line];
        }
        continue;
      }

      // Check for CREATE statements
      if (createPattern.test(line)) {
        if (mainStatementStart !== null) {
          // Save previous statement
          const stmtContent = mainStatementContent.join('\n');
          const stmtDeps = allDependencies.filter((d) => d.line >= mainStatementStart! && d.line <= i);
          chunks.push({
            content: stmtContent,
            type: 'statement',
            startLine: mainStatementStart,
            endLine: i,
            dependencies: stmtDeps,
          });
        }
        mainStatementStart = lineNum;
        mainStatementContent = [line];

        // Check if this CREATE statement ends on the same line (has semicolon)
        if (line.includes(';')) {
          const stmtContent = mainStatementContent.join('\n');
          const stmtDeps = allDependencies.filter((d) => d.line === lineNum);
          chunks.push({
            content: stmtContent,
            type: 'statement',
            startLine: mainStatementStart,
            endLine: lineNum,
            dependencies: stmtDeps,
          });
          mainStatementStart = null;
          mainStatementContent = [];
        }
        continue;
      }

      // Check for standalone SELECT/INSERT/UPDATE/DELETE (not part of WITH)
      if (mainQueryPattern.test(line) && mainStatementStart === null) {
        mainStatementStart = lineNum;
        mainStatementContent = [line];
        continue;
      }

      // Check for statement end (semicolon) to finalize current CREATE/SELECT statement
      if (mainStatementStart !== null && line.includes(';') && !inWith) {
        mainStatementContent.push(line);
        const stmtContent = mainStatementContent.join('\n');
        const stmtDeps = allDependencies.filter((d) => d.line >= mainStatementStart! && d.line <= lineNum);
        chunks.push({
          content: stmtContent,
          type: 'statement',
          startLine: mainStatementStart,
          endLine: lineNum,
          dependencies: stmtDeps,
        });
        mainStatementStart = null;
        mainStatementContent = [];
        continue;
      }

      // Check for dbt config block as first content
      if (configPattern.test(line) && chunks.length === 0 && mainStatementStart === null) {
        // Find the end of the config block
        let configEnd = i;
        let braceDepth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
        const configLines = [line];

        while (braceDepth > 0 && configEnd < lines.length - 1) {
          configEnd++;
          configLines.push(lines[configEnd]);
          braceDepth += (lines[configEnd].match(/\(/g) || []).length - (lines[configEnd].match(/\)/g) || []).length;
        }

        chunks.push({
          content: configLines.join('\n'),
          type: 'config',
          startLine: lineNum,
          endLine: configEnd + 1,
          dependencies: [],
        });

        i = configEnd;
        continue;
      }

      // Continue building current statement
      if (mainStatementStart !== null) {
        mainStatementContent.push(line);
      }
    }

    // Finalize any remaining statement
    if (mainStatementStart !== null && mainStatementContent.length > 0) {
      const stmtContent = mainStatementContent.join('\n');
      const stmtDeps = allDependencies.filter((d) => d.line >= mainStatementStart! && d.line <= lines.length);
      chunks.push({
        content: stmtContent,
        type: 'statement',
        startLine: mainStatementStart,
        endLine: lines.length,
        dependencies: stmtDeps,
      });
    }

    return chunks;
  }

  /**
   * Extracts dbt macro definitions from content.
   * Handles {% macro name(...) %} ... {% endmacro %} blocks.
   *
   * @param content - The SQL file content
   * @returns Array of SqlChunkInfo objects for each macro
   */
  private extractDbtMacros(content: string): SqlChunkInfo[] {
    const macros: SqlChunkInfo[] = [];
    const lines = content.split('\n');

    // Pattern for macro start: {% macro name(args) %} or {%- macro name(args) -%}
    const macroStartPattern = /\{%[-\s]*macro\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

    // Pattern for macro end: {% endmacro %} or {%- endmacro -%}
    const macroEndPattern = /\{%[-\s]*endmacro\s*[-]?%\}/;

    let currentMacro: { name: string; startLine: number; content: string[] } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      if (currentMacro) {
        currentMacro.content.push(line);

        if (macroEndPattern.test(line)) {
          const macroContent = currentMacro.content.join('\n');
          const macroDeps = this.extractSqlDependencies(macroContent);

          macros.push({
            content: macroContent,
            type: 'macro',
            name: currentMacro.name,
            startLine: currentMacro.startLine,
            endLine: lineNum,
            dependencies: macroDeps,
          });

          currentMacro = null;
        }
      } else {
        const startMatch = line.match(macroStartPattern);
        if (startMatch) {
          currentMacro = {
            name: startMatch[1],
            startLine: lineNum,
            content: [line],
          };
        }
      }
    }

    return macros;
  }

  /**
   * Creates a CodeChunk for SQL content with dependency information.
   *
   * @param params - Parameters for SQL chunk creation
   * @returns Complete CodeChunk object with semantic_text
   */
  private createSqlChunk(params: {
    content: string;
    relativePath: string;
    gitFileHash: string;
    gitBranch: string;
    startLine: number;
    endLine: number;
    timestamp: string;
    kind: string;
    name?: string;
    dependencies: SqlDependency[];
  }): CodeChunk {
    const chunkHash = createChunkHash({
      type: CHUNK_TYPE_CODE,
      language: LANG_SQL,
      relativePath: params.relativePath,
      gitBranch: params.gitBranch,
      gitFileHash: params.gitFileHash,
      startLine: params.startLine,
      endLine: params.endLine,
      startIndex: 0,
      endIndex: params.content.length,
      content: params.content,
    });
    const directoryInfo = extractDirectoryInfo(params.relativePath);

    // Convert SQL dependencies to imports format
    const imports = params.dependencies
      .filter((d) => d.type === 'ref' || d.type === 'source')
      .map((d) => ({
        path: d.type === 'ref' ? `ref:${d.name}` : `source:${d.schema}.${d.name}`,
        type: 'file' as const,
        symbols: [d.name],
      }));

    // Create symbols from dependency types
    const symbols: SymbolInfo[] = params.dependencies.map((d) => ({
      name: d.name,
      kind: `sql.${d.type}`,
      line: d.line,
    }));

    const baseChunk: Omit<CodeChunk, 'semantic_text' | 'code_vector'> = {
      type: CHUNK_TYPE_CODE,
      language: LANG_SQL,
      kind: params.kind,
      imports,
      symbols,
      exports: [],
      containerPath: params.name || '',
      filePath: params.relativePath,
      ...directoryInfo,
      git_file_hash: params.gitFileHash,
      git_branch: params.gitBranch,
      chunk_hash: chunkHash,
      startLine: params.startLine,
      endLine: params.endLine,
      content: params.content,
      created_at: params.timestamp,
      updated_at: params.timestamp,
    };

    return {
      ...baseChunk,
      semantic_text: this.prepareSemanticText(baseChunk),
    };
  }

  private parseWithTreeSitter(
    filePath: string,
    gitBranch: string,
    relativePath: string,
    langConfig: LanguageConfiguration
  ): { chunks: CodeChunk[]; chunksSkipped: number } {
    const now = new Date().toISOString();
    const parser = new Parser();
    parser.setLanguage(langConfig.parser);

    const sourceCode = fs.readFileSync(filePath, 'utf8');
    const tree = parser.parse(sourceCode);
    const query = new Query(langConfig.parser, langConfig.queries.join('\n'));
    const matches = query.matches(tree.rootNode);
    // Use execFileSync to prevent shell injection from special characters in file paths
    const gitFileHash = execFileSync('git', ['hash-object', filePath]).toString().trim();

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
          // Bash `source` / `.` statements treat paths as file paths, even without a leading `./`.
          // We normalize non-absolute paths to be repo-root-relative for consistency in indexing/tests.
          if (langConfig.name === 'bash') {
            type = 'file';
            if (!path.isAbsolute(importPath)) {
              const resolvedPath = path.resolve(path.dirname(filePath), importPath);
              // Use execFileSync to prevent shell injection from special characters in directory paths
              const gitRoot = getGitRoot(path.dirname(filePath));
              importPath = path.relative(gitRoot, resolvedPath);
            }
          } else if (importPath.startsWith('.')) {
            const resolvedPath = path.resolve(path.dirname(filePath), importPath);
            // Use execFileSync to prevent shell injection from special characters in directory paths
            const gitRoot = getGitRoot(path.dirname(filePath));
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

    // For Python, check if __all__ is defined and use it as the authoritative export list
    let pythonAllSet: Set<string> | null = null;
    if (langConfig.name === 'python') {
      try {
        const allQuery = new Query(
          langConfig.parser,
          '(assignment left: (identifier) @all_name (#eq? @all_name "__all__") right: (list) @all_list)'
        );
        const allMatches = allQuery.matches(tree.rootNode);

        if (allMatches.length > 0) {
          // Use the last __all__ assignment if there are multiple
          const lastMatch = allMatches[allMatches.length - 1];
          const listNode = lastMatch.captures.find((c) => c.name === 'all_list')?.node;
          if (listNode) {
            const pythonAllList: string[] = [];
            // Extract string literals from the list
            // This handles standard Python strings (single/double quoted)
            // Note: f-strings, raw strings, and other special formats may not be extracted correctly
            for (let i = 0; i < listNode.namedChildCount; i++) {
              const child = listNode.namedChild(i);
              if (child && child.type === 'string') {
                // Standard Python strings have structure: string_start, string_content, string_end
                // For simple strings without prefixes, the content is at index 1
                const stringContent = child.child(1);
                if (stringContent && stringContent.type === 'string_content') {
                  pythonAllList.push(stringContent.text);
                } else {
                  // If the expected structure is not found, log a warning and skip
                  logger.warn(`Unexpected string structure in __all__ at index ${i}: ${child.toString()}`);
                }
              }
            }
            // Use a Set for O(1) lookup performance
            pythonAllSet = new Set(pythonAllList);
          }
        }
      } catch (error) {
        logger.warn(`Failed to parse Python __all__: ${error instanceof Error ? error.message : String(error)}`);
        // Fall back to pattern-based detection
        pythonAllSet = null;
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
              const identifierNode = parent.children.find(
                (child) => child.type === 'identifier' || child.type === 'type_identifier'
              );
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
                // Use execFileSync to prevent shell injection from special characters in directory paths
                const gitRoot = getGitRoot(path.dirname(filePath));
                exportTarget = path.relative(gitRoot, resolvedPath);
              } catch (error) {
                logger.warn(
                  `Failed to resolve re-export path: ${exportTarget}`,
                  error instanceof Error ? error : new Error(String(error))
                );
                // Keep the original relative path
              }
            }
          }
        }

        if (exportName || exportType === 'namespace') {
          // For Python, filter exports based on __all__ if it exists
          // Skip filtering for namespace exports (not applicable to Python anyway)
          if (langConfig.name === 'python' && pythonAllSet !== null && exportType !== 'namespace') {
            if (!pythonAllSet.has(exportName)) {
              continue; // Skip this export - not in __all__
            }
          }

          // Bash: filter declaration_command to only actual exports
          // Tree-sitter can't distinguish export/readonly/local/declare (unnamed node)
          if (langConfig.name === 'bash') {
            const nameCapture = match.captures.find((c) => c.name === EXPORT_CAPTURE_NAMES.NAME);
            if (nameCapture) {
              // Navigate to declaration_command node:
              // 'export VAR=value': variable_name -> variable_assignment -> declaration_command
              // 'export -f funcname': variable_name -> declaration_command
              let declNode = nameCapture.node.parent;

              // Handle variable assignment case: variable_name -> variable_assignment -> declaration_command
              if (declNode?.type === 'variable_assignment') {
                declNode = declNode.parent;
              }

              if (declNode && declNode.type === 'declaration_command') {
                const firstChild = declNode.child(0);
                if (firstChild) {
                  // Only accept 'export' keyword, reject readonly/local/declare
                  if (firstChild.type !== 'export') {
                    continue; // Skip - not an actual export statement
                  }
                  // For 'export -f funcname', verify -f flag is present
                  if (match.captures.some((c) => c.name === 'flag')) {
                    const wordNode = Array.from({ length: declNode.childCount }, (_, i) => declNode.child(i)).find(
                      (child) => child?.type === 'word'
                    );
                    if (!wordNode || wordNode.text !== '-f') {
                      continue; // Skip - not 'export -f'
                    }
                  }
                }
              }
            }
          }

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

    const uniqueMatches = Array.from(
      new Map(
        matches.map((match) => {
          const node = match.captures[0].node;
          return [`${node.startIndex}-${node.endIndex}`, match];
        })
      ).values()
    );

    let chunksSkipped = 0;
    const chunks = uniqueMatches
      .map(({ captures }): CodeChunk | null => {
        const node = captures[0].node;
        const content = node.text;
        const contentSize = Buffer.byteLength(content, 'utf8');
        if (contentSize > indexingConfig.maxChunkSizeBytes) {
          logger.warn(`Skipping chunk in ${filePath} because it is larger than maxChunkSizeBytes`);
          chunksSkipped++;
          return null;
        }
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const chunkHash = createChunkHash({
          type: CHUNK_TYPE_CODE,
          language: langConfig.name,
          relativePath,
          gitBranch,
          gitFileHash,
          startLine,
          endLine,
          startIndex: node.startIndex,
          endIndex: node.endIndex,
          content: content,
        });

        let containerPath = '';
        let parent = node.parent;
        if (parent) {
          if (parent.type === 'class_body') {
            parent = parent.parent;
          }

          if (
            parent &&
            (parent.type === 'class_declaration' ||
              parent.type === 'function_declaration' ||
              parent.type === 'class_definition')
          ) {
            const nameNode = parent.namedChildren.find(
              (child) => child.type === 'identifier' || child.type === 'type_identifier'
            );
            if (nameNode) {
              containerPath = nameNode.text;
            }
          }
        }

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
      })
      .filter((chunk): chunk is CodeChunk => chunk !== null);

    return { chunks, chunksSkipped };
  }

  private prepareSemanticText(
    chunk: Omit<
      CodeChunk,
      'semantic_text' | 'code_vector' | 'created_at' | 'updated_at' | 'chunk_hash' | 'git_file_hash'
    >
  ): string {
    // IMPORTANT: `semantic_text` is stored on the content-deduplicated chunk document.
    // It must NOT include file-specific metadata (paths/directories/branches), otherwise a chunk
    // that appears in many files would be "tagged" with an arbitrary file path depending on
    // ingestion order.
    const header: string[] = [];
    header.push(`language: ${chunk.language}`);
    if (chunk.kind) {
      header.push(`kind: ${chunk.kind}`);
    }
    if (chunk.containerPath) {
      header.push(`containerPath: ${chunk.containerPath}`);
    }

    return `${header.join('\n')}\n\n${chunk.content}`;
  }
}
