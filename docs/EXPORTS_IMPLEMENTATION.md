# Exports Field Implementation Summary

## Overview

This document summarizes the implementation of the `exports` field for the `CodeChunk` type, which enables capturing export statements across all supported languages (TypeScript, JavaScript, Python, Java, Go).

## Changes Made

### 1. Core Data Model Updates

**File: `src/utils/elasticsearch.ts`**

- Added `exports` field to the `CodeChunk` interface:
  ```typescript
  exports?: { name: string; type: 'named' | 'default' | 'namespace'; target?: string }[];
  ```
  - `name`: The exported symbol name
  - `type`: Export type (named, default, or namespace)
  - `target`: For re-exports, the source module path (resolved to repository-relative path)

- Updated Elasticsearch index mapping:
  ```typescript
  exports: {
    type: 'nested',
    properties: {
      name: { type: 'keyword' },
      type: { type: 'keyword' },
      target: { type: 'keyword' },
    },
  }
  ```

### 2. Parser Configuration Updates

**File: `src/utils/parser.ts`**

- Added `exportQueries?: string[]` field to `LanguageConfiguration` interface
- Implemented export processing logic in `parseWithTreeSitter` method:
  - Creates `exportsByLine` map similar to `importsByLine`
  - Processes export queries to extract name, type, and optional target
  - Resolves relative re-export paths to repository-relative paths
  - Assigns exports to chunks based on line numbers

### 3. Language-Specific Export Queries

#### TypeScript (`src/languages/typescript.ts`)

Export queries for:
- Named exports: `export const`, `export function`, `export class`, `export interface`, `export type`
- Default exports: `export default`
- Re-exports: `export { ... } from`, `export * from`
- Export clauses: `export { name }`, `export { renamed as alias }`

#### JavaScript (`src/languages/javascript.ts`)

Export queries for:
- Named exports: `export const`, `export function`, `export class`
- Default exports: `export default`
- Re-exports: `export { ... } from`, `export * from`
- Export clauses: `export { name }`, `export { renamed as alias }`

#### Python (`src/languages/python.ts`)

Export queries for:
- Module-level function definitions: `def function_name():` (top-level, not inside class)
- Module-level class definitions: `class ClassName:`
- Module-level uppercase constants: `CONSTANT = value` (matches pattern `^[A-Z_][A-Z0-9_]*$`)

Note: Python doesn't have explicit export keywords; top-level definitions and uppercase constants are considered public exports.

#### Java (`src/languages/java.ts`)

Export queries for:
- Public class declarations: `public class`
- Public method declarations: `public` methods
- Public interface declarations: `public interface`
- Public enum declarations: `public enum`

Note: Java uses `public` modifier to indicate exports. Private members are not captured.

#### Go (`src/languages/go.ts`)

Export queries for:
- Exported function declarations: Functions starting with uppercase letter
- Exported type declarations: Types starting with uppercase letter
- Exported const declarations: Constants starting with uppercase letter
- Exported var declarations: Variables starting with uppercase letter

Note: Go uses capitalization to indicate exports. Lowercase identifiers are package-private and not captured.

Also added `(const_declaration) @const` to the main queries to ensure const declarations are captured as chunks.

### 4. Test Updates

**File: `tests/parser.test.ts`**

Added comprehensive export detection tests:

1. **TypeScript export test** - Validates:
   - Named exports (const, function, class, interface, type)
   - Default exports

2. **JavaScript export test** - Validates:
   - Named exports (const, function, class)
   - Default exports

3. **Python export test** - Validates:
   - Top-level functions
   - Top-level classes
   - Uppercase constants

4. **Java export test** - Validates:
   - Public classes
   - Public methods
   - Excludes private methods

5. **Go export test** - Validates:
   - Capitalized functions
   - Capitalized types
   - Capitalized constants
   - Excludes lowercase (private) identifiers

**Updated Test Fixtures:**

- `tests/fixtures/typescript.ts` - Added export statements
- `tests/fixtures/javascript.js` - Added export statements
- `tests/fixtures/python.py` - Added uppercase constant
- `tests/fixtures/java.java` - Added public class modifier and private method
- `tests/fixtures/go.go` - Added const declaration and private function

### 5. Snapshot Updates

All test snapshots were updated to include the `exports` field in the expected output.

## Technical Implementation Details

### Export Type Detection

The implementation uses tree-sitter capture names to determine export types:

- `@export.name` - Named exports (the symbol being exported)
- `@export.default` - Default exports
- `@export.namespace` - Namespace exports (`export * from`)
- `@export.source` - Source path for re-exports

### Path Resolution for Re-exports

For re-exports with relative paths (e.g., `export * from './module'`):
1. Resolve the relative path using Node.js `path.resolve`
2. Get the git repository root using `git rev-parse --show-toplevel`
3. Convert to repository-relative path using `path.relative`

This ensures consistent path references across the codebase.

### Line-Based Association

Exports are associated with chunks based on the start line of the export statement, similar to how imports are handled. This ensures that:
- Export statements appear on the chunk where they are declared
- Multiple exports on the same line are grouped together
- Re-exports maintain their association with the correct chunk

### Export Duplication Behavior

**Important Note**: For exported declarations (e.g., `export class MyClass {}`), exports appear on **both** the `export_statement` chunk AND the declaration chunk (e.g., `class_declaration`). This is intentional and follows the tree-sitter AST structure:

1. **Export Statement Chunk** (kind: `export_statement`) - Contains the entire export statement including the declaration
2. **Declaration Chunk** (kind: `class_declaration`, `function_declaration`, etc.) - Contains just the declaration

For example, `export class MyClass {}` creates:
- Chunk 1: `kind: "export_statement"`, `exports: [{ name: "MyClass", type: "named" }]`
- Chunk 2: `kind: "class_declaration"`, `exports: [{ name: "MyClass", type: "named" }]`

This duplication allows querying exports at both levels:
- Search for export statements specifically (using `kind: export_statement`)
- Search for exported classes/functions (using `kind: class_declaration` with `exports` filter)

When aggregating exports, ensure deduplication based on `name` and `type` to avoid counting the same export twice.

## Use Cases Enabled

1. **API Discovery**: Find all public APIs exported by a module
2. **Dependency Analysis**: Understand what symbols are exported and potentially consumed elsewhere
3. **Code Navigation**: Navigate from exports to their definitions
4. **Re-export Tracking**: Track re-export chains across modules
5. **Public API Surface**: Identify the public API surface of packages and modules

## Verification

The implementation was verified with:
1. Unit tests covering export detection for all languages
2. Snapshot tests ensuring output consistency
3. Build and lint verification
4. All 36 tests passing

## Example Output

### TypeScript Export
```typescript
{
  "exports": [
    {
      "name": "MyClass",
      "type": "named"
    }
  ],
  "content": "export class MyClass { ... }",
  ...
}
```

### Re-export with Target
```typescript
{
  "exports": [
    {
      "name": "*",
      "type": "namespace",
      "target": "src/utils/helpers"
    }
  ],
  "content": "export * from './helpers'",
  ...
}
```

### Python Top-level Export
```python
{
  "exports": [
    {
      "name": "my_function",
      "type": "named"
    }
  ],
  "content": "def my_function():\n    pass",
  ...
}
```

## Breaking Changes

None. The `exports` field is optional and backward compatible with existing code chunks.

## Future Enhancements

1. **Enhanced Python Export Detection**: Parse `__all__` list for explicit exports
2. **Module-level Exports**: Track module-level exports separately from symbol exports
3. **Export Aliases**: Better handling of renamed exports
4. **TypeScript Type-only Exports**: Distinguish between value and type exports
