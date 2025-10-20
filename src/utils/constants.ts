import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';

/**
 * A map of file extensions to Tree-sitter parsers.
 *
 * This is used to determine which parser to use for a given file type.
 * A value of `null` indicates that a custom parser should be used.
 */
// The tree-sitter language packages (e.g., tree-sitter-typescript) do not share a common, importable type
// for the language parser object, making it impractical to type this map statically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parsers: { [key: string]: any } = {
  '.ts': TypeScript.typescript,
  '.tsx': TypeScript.tsx,
  '.js': JavaScript,
  '.jsx': JavaScript,
  '.md': null,
  '.mdx': null,
};

/**
 * An array of supported file extensions.
 *
 * This is derived from the keys of the `parsers` object.
 */
export const SUPPORTED_FILE_EXTENSIONS = Object.keys(parsers);

/**
 * Attribute keys for repository context in OpenTelemetry logs and metrics.
 */
export const ATTR_REPO_NAME = 'repo.name';
export const ATTR_REPO_BRANCH = 'repo.branch';

/**
 * Queue status values for document processing.
 */
export const QUEUE_STATUS_PENDING = 'pending';
export const QUEUE_STATUS_PROCESSING = 'processing';
export const QUEUE_STATUS_FAILED = 'failed';

/**
 * Code chunk types for document classification.
 */
export const CHUNK_TYPE_CODE = 'code';
export const CHUNK_TYPE_DOC = 'doc';

/**
 * Language identifiers for code parsing and indexing.
 */
export const LANG_TYPESCRIPT = 'typescript';
export const LANG_JAVASCRIPT = 'javascript';
export const LANG_MARKDOWN = 'markdown';
export const LANG_YAML = 'yaml';
export const LANG_JSON = 'json';
export const LANG_TEXT = 'text';
export const LANG_GRADLE = 'gradle';
export const LANG_PYTHON = 'python';
export const LANG_JAVA = 'java';
export const LANG_GO = 'go';

/**
 * Parser type identifiers for metrics and logging.
 */
export const PARSER_TYPE_TREE_SITTER = 'tree-sitter';
export const PARSER_TYPE_MARKDOWN = 'markdown';
export const PARSER_TYPE_YAML = 'yaml';
export const PARSER_TYPE_JSON = 'json';
export const PARSER_TYPE_TEXT = 'text';

/**
 * Worker message status values.
 */
export const MESSAGE_STATUS_SUCCESS = 'success';
export const MESSAGE_STATUS_FAILURE = 'failure';

/**
 * Metric status values.
 */
export const METRIC_STATUS_SUCCESS = 'success';
export const METRIC_STATUS_FAILURE = 'failure';

/**
 * Default/fallback values.
 */
export const LANGUAGE_UNKNOWN = 'unknown';