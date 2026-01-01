# Directory Fields Implementation Summary

## Overview

Successfully implemented indexed directory fields to enable efficient directory-level aggregations and discovery in the semantic code search indexer. This enhancement enables the MCP server to help LLMs navigate large codebases (70K+ files) by discovering significant directories before diving into specific files.

Note: Per-file directory and path information is stored in a dedicated `<index>_locations` index (one document per chunk occurrence). The primary `<index>` stores content-deduplicated chunk documents and intentionally does **not** store file paths or directory metadata.

## Changes Made

### 1. Core Data Model Updates

**File: `src/utils/elasticsearch.ts`**
- Added three new fields to the `CodeChunk` interface:
  - `directoryPath: string` - Full directory path (e.g., "src/utils")
  - `directoryName: string` - Immediate parent directory name (e.g., "utils")
  - `directoryDepth: number` - Depth in directory tree (0 for root)
  
- Updated Elasticsearch storage model:
  - The primary chunk index (`<index>`) stores content-deduplicated chunk documents (no file paths / directories).
  - The locations index (`<index>_locations`) stores per-file occurrences, including:
    - `filePath` (`wildcard`)
    - `directoryPath` (`keyword`)
    - `directoryName` (`keyword`)
    - `directoryDepth` (`integer`)

### 2. Parser Implementation

**File: `src/utils/parser.ts`**
- Added `extractDirectoryInfo()` helper function to parse file paths
- Updated `parseEntireFileAsChunk()` to extract and include directory info
- Updated `parseWithTreeSitter()` to extract and include directory info
- Updated `prepareSemanticText()` to avoid file-specific metadata (paths/directories) because `semantic_text` is stored on content-deduplicated chunk documents

### 3. Test Updates

**Files: `tests/*.test.ts`**
- Updated all mock `CodeChunk` objects with directory fields
- Added comprehensive tests for directory field extraction:
  - Root-level files (depth 0)
  - Single-level directories (depth 1)
  - Nested directories (depth 2+)
- Updated test snapshots to include new fields

### 4. Documentation

**File: `docs/elasticsearch_guide.md`**
- Updated index mapping documentation
- Added field descriptions for new directory fields

**File: `docs/directory_aggregations.md`** (NEW)
- Comprehensive guide for using directory aggregations
- Query examples for common use cases:
  - Discovering significant directories (with README, package.json, etc.)
  - Navigating by directory depth
  - Exploring directory contents
  - Finding directory-level patterns
- Example MCP tool implementation (`discover_directories`)

## Implementation Details

### Directory Depth Calculation

The depth is calculated by counting path separators in the normalized path:
- Root-level files: depth = 0 (e.g., "package.json")
- First-level directories: depth = 1 (e.g., "src/config.ts" → "src" = 1)
- Nested directories: depth = n (e.g., "src/utils/parser.ts" → "src/utils" = 2)

### Semantic Text Enhancement

The indexed `semantic_text` avoids file-specific metadata and includes only stable headers:
```
language: typescript
kind: import_statement
containerPath: src/utils/elasticsearch.ts

[actual code content]
```

Directory context is provided via `<index>_locations` filtering, not in `semantic_text`.

## Verification

The implementation was verified with:
1. Unit tests covering all directory depth scenarios
2. Snapshot tests ensuring output consistency
3. Manual verification showing correct field population:
   - Root file: `directoryPath=""`, `directoryName=""`, `directoryDepth=0`
   - `src/config.ts`: `directoryPath="src"`, `directoryName="src"`, `directoryDepth=1`
   - `src/utils/parser.ts`: `directoryPath="src/utils"`, `directoryName="utils"`, `directoryDepth=2`

## Use Cases Enabled

1. **Fast Directory Discovery**: Query for directories containing specific markers (README.md, package.json)
2. **Hierarchical Navigation**: Browse codebases layer by layer using depth filters
3. **Package Detection**: Identify significant directories that represent packages or modules
4. **LLM Assistance**: Help LLMs find the right starting point in large codebases

## Performance Impact

- **Indexing**: Directory extraction is a simple path operation.
- **Querying**: Directory-based aggregations are performed on `<index>_locations` (keyword fields are fast).
- **Storage**: Directory fields are stored per *occurrence* (location doc), not per chunk doc. This increases storage proportionally to the number of file occurrences, but avoids "mega-documents" and update contention.

## Future Enhancements

The directory fields enable future MCP tools like:
- `discover_directories` - Find significant directories
- `list_packages` - List all packages/modules
- `navigate_hierarchy` - Browse codebase structure
- `find_similar_directories` - Find directories with similar content patterns

## Breaking Changes

This change set is not fully backwards compatible:
- The primary chunk index mapping no longer stores file-level fields (`filePath`, `filePaths[]`, `fileCount`, directory fields, line ranges).
- Per-file location and directory metadata is stored exclusively in `<index>_locations`.
- A clean reindex is required when migrating existing indices.
