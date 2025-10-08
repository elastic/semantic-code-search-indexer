# PR: Add Directory Fields to Enable Efficient Directory Discovery

## Overview

This PR implements indexed directory fields for code chunks to enable efficient directory-level aggregations and discovery in the MCP server. This enhancement helps LLMs navigate large codebases (70K+ files) by discovering significant directories before diving into specific files.

## Problem Statement

LLMs struggle to navigate large codebases efficiently because they don't know which directories contain important packages or modules. Without directory-level metadata, they must either:
1. Search through thousands of individual files
2. Use expensive file-by-file exploration
3. Make random guesses about where to start

## Solution

Index directory metadata once at ingestion time, enabling fast aggregations that surface significant directories (those with README.md, package.json, etc.).

## Changes

### 1. New Directory Fields (3 fields added)

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `directoryPath` | `keyword` | Full directory path | `src/utils` |
| `directoryName` | `keyword` | Immediate parent directory | `utils` |
| `directoryDepth` | `integer` | Depth in tree (0 = root) | `2` |

### 2. Core Implementation

**Data Model** (`src/utils/elasticsearch.ts`):
- Extended `CodeChunk` interface with directory fields
- Updated Elasticsearch index mapping with keyword and integer types for fast aggregations

**Parser** (`src/utils/parser.ts`):
- Added `extractDirectoryInfo()` helper function
- Enhanced both parsing methods to extract directory metadata
- Updated semantic text to include directory context

**Tests** (`tests/*.test.ts`):
- Updated all mock fixtures
- Added comprehensive tests for all directory depths (0, 1, 2+)
- Verified edge cases (root files, nested paths)

### 3. Documentation

**User Guides**:
- `docs/elasticsearch_guide.md` - Updated field reference
- `docs/directory_aggregations.md` - Comprehensive aggregation guide with examples
- `docs/IMPLEMENTATION_SUMMARY.md` - Technical implementation details

## Query Examples

### Find Significant Directories
```json
{
  "query": {
    "bool": {
      "should": [
        { "term": { "filePath": "README.md" } },
        { "term": { "filePath": "package.json" } }
      ]
    }
  },
  "aggs": {
    "directories": {
      "terms": { "field": "directoryPath" }
    }
  }
}
```

### Navigate by Depth
```json
{
  "query": {
    "term": { "directoryDepth": 1 }
  },
  "aggs": {
    "top_level_dirs": {
      "terms": { "field": "directoryPath" }
    }
  }
}
```

## Impact

### Benefits
- ✅ **Fast Discovery**: Keyword fields enable efficient aggregations on millions of documents
- ✅ **Hierarchical Navigation**: Depth field allows exploring codebases layer by layer
- ✅ **Package Detection**: Easy to identify significant directories with markers
- ✅ **LLM-Friendly**: Helps LLMs find the right starting point in large codebases

### Performance
- **Storage**: +20-50 bytes per chunk (negligible)
- **Indexing**: No significant impact (simple path parsing)
- **Query**: Improved performance for directory aggregations (keyword fields are fast)

### Compatibility
- ✅ **No Breaking Changes**: All existing queries continue to work
- ✅ **Backwards Compatible**: New fields are optional
- ✅ **Test Suite**: All tests pass (except 2 that require ES config, as expected)

## Future Enhancements

These fields enable new MCP tools:
- `discover_directories` - Find significant directories
- `list_packages` - List all packages/modules  
- `navigate_hierarchy` - Browse codebase structure
- `find_similar_directories` - Find directories with similar patterns

## Testing

- ✅ All parser tests pass with new directory field tests
- ✅ Snapshots updated to include directory metadata
- ✅ Manual verification across all depth levels (0, 1, 2+)
- ✅ Build succeeds without errors
- ✅ Mock fixtures updated in all test files

## Files Changed

- **Core**: 3 files (elasticsearch.ts, parser.ts, sqlite_queue.ts)
- **Tests**: 4 test files + snapshots
- **Docs**: 3 documentation files (1 updated, 2 new)
- **Total**: 12 files, 551 insertions, 3 deletions

## Verification

```bash
# Build
npm run build  # ✅ Success

# Tests
npm test  # ✅ 22 tests pass, 10 snapshots updated

# Manual verification
node -e "..." # ✅ Verified all depth levels work correctly
```

## Migration

No migration required. When the index is recreated (with `--clean` flag), the new fields will be included automatically. Existing indexes will continue to work but won't have directory fields until reindexed.
