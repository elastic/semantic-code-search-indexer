// src/utils/language_helpers.ts
//
// Language-specific helper functions extracted from parser.ts.
// These handle Bash and Python quirks that don't belong in the generic parsing infrastructure.

import path from 'path';
import Parser from 'tree-sitter';
import { logger } from './logger';

const { Query } = Parser;

/**
 * Normalizes a Bash import path (from `source` / `.` statements).
 *
 * Bash treats all import paths as file paths, even without a leading `./`.
 * Non-absolute paths are resolved relative to the file's directory, then made
 * relative to the git root for consistency in indexing and tests.
 *
 * @param importPath - The raw import path from the tree-sitter capture
 * @param filePath - Absolute path to the file being parsed
 * @param gitRoot - Absolute path to the git repository root
 * @returns Object with the normalized path and type 'file'
 */
export function resolveBashImport(
  importPath: string,
  filePath: string,
  gitRoot: string
): { path: string; type: 'file' } {
  if (!path.isAbsolute(importPath)) {
    const resolvedPath = path.resolve(path.dirname(filePath), importPath);
    importPath = path.relative(gitRoot, resolvedPath);
  }
  return { path: importPath, type: 'file' };
}

/**
 * Parses Python's `__all__` list to determine the authoritative export list.
 *
 * If `__all__` is defined, only names in the list should be treated as exports.
 * Uses the last `__all__` assignment if there are multiple. Returns `null` if
 * `__all__` is not defined or cannot be parsed (graceful fallback — all exports
 * are included).
 *
 * @param tree - The parsed tree-sitter tree for the Python file
 * @param parser - The tree-sitter Python language parser
 * @returns A Set of exported names, or null if __all__ is not defined
 */
export function filterPythonExportsByAll(
  tree: Parser.Tree,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parser: any
): Set<string> | null {
  try {
    const allQuery = new Query(
      parser,
      '(assignment left: (identifier) @all_name (#eq? @all_name "__all__") right: (list) @all_list)'
    );
    const allMatches = allQuery.matches(tree.rootNode);

    if (allMatches.length === 0) {
      return null;
    }

    // Use the last __all__ assignment if there are multiple
    const lastMatch = allMatches[allMatches.length - 1];
    const listNode = lastMatch.captures.find((c: Parser.QueryCapture) => c.name === 'all_list')?.node;
    if (!listNode) {
      return null;
    }

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
    return new Set(pythonAllList);
  } catch (error) {
    logger.warn(`Failed to parse Python __all__: ${error instanceof Error ? error.message : String(error)}`);
    // Fall back to pattern-based detection — all exports included
    return null;
  }
}

/**
 * Verifies that a Bash declaration_command capture is an actual `export` statement.
 *
 * Tree-sitter captures all declaration_command nodes (export, readonly, local, declare)
 * because the keyword is an unnamed node. This function walks the AST from the
 * variable_name capture up to the declaration_command node and checks:
 * 1. The first child is the `export` keyword (not readonly/local/declare)
 * 2. For function exports (`export -f`), the `-f` flag is present
 *
 * @param match - The tree-sitter query match
 * @param nameCapture - The capture for the export.name node
 * @returns true if this is an actual export declaration, false otherwise
 */
export function isBashExportDeclaration(match: Parser.QueryMatch, nameCapture: Parser.QueryCapture): boolean {
  // Navigate to declaration_command node:
  // 'export VAR=value': variable_name -> variable_assignment -> declaration_command
  // 'export -f funcname': variable_name -> declaration_command
  let declNode = nameCapture.node.parent;

  // Handle variable assignment case: variable_name -> variable_assignment -> declaration_command
  if (declNode?.type === 'variable_assignment') {
    declNode = declNode.parent;
  }

  if (!declNode || declNode.type !== 'declaration_command') {
    // If we can't find a declaration_command ancestor, conservatively allow through
    // (preserves pre-refactor behavior where only explicit non-export keywords were rejected)
    return true;
  }

  const firstChild = declNode.child(0);
  if (!firstChild) {
    return true;
  }

  // Only accept 'export' keyword, reject readonly/local/declare
  if (firstChild.type !== 'export') {
    return false;
  }

  // For 'export -f funcname', verify -f flag is present
  if (match.captures.some((c: Parser.QueryCapture) => c.name === 'flag')) {
    const wordNode = Array.from({ length: declNode.childCount }, (_, i) => declNode!.child(i)).find(
      (child) => child?.type === 'word'
    );
    if (!wordNode || wordNode.text !== '-f') {
      return false;
    }
  }

  return true;
}
