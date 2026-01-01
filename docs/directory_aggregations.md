# Directory Aggregations

The indexer stores per-file directory metadata in `<index>_locations` (one document per chunk occurrence). This enables efficient directory-level aggregations and discovery without relying on nested fields on the primary chunk documents.

## Directory Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `directoryPath` | `keyword` | Full directory path containing the file | `src/utils`, `packages/core/server` |
| `directoryName` | `keyword` | Name of the immediate parent directory | `utils`, `server` |
| `directoryDepth` | `integer` | Depth in the directory tree (0 for root) | `2` (for `src/utils`), `3` (for `packages/core/server`) |

## Use Cases

### 1. Discover Significant Directories

Find directories that contain important package markers:

Example: directories that contain a `package.json`:

```json
{
  "size": 0,
  "query": {
    "wildcard": { "filePath": "*package.json" }
  },
  "aggs": {
    "directories": {
      "terms": { "field": "directoryPath", "size": 1000 }
    }
  }
}
```

### 2. Navigate by Directory Depth

Find top-level packages (depth 1):

```json
{
  "size": 0,
  "query": {
    "term": { "directoryDepth": 1 }
  },
  "aggs": {
    "top_level_dirs": {
      "terms": { "field": "directoryPath", "size": 1000 }
    }
  }
}
```

### 3. Explore Directory Contents

Get all files in a specific directory:

```json
{
  "query": {
    "term": { "directoryPath": "src/utils" }
  },
  "size": 0,
  "aggs": {
    "files": {
      "terms": { "field": "filePath", "size": 1000 }
    }
  }
}
```

### 4. Find Directory-Level Patterns

Discover directories with specific content patterns:

Directory-level pattern discovery is a **two-step join**:

1. Query the chunk index (`<index>`) for the content/symbol pattern to get matching chunk `_id` values.
2. Query `<index>_locations` with `terms: { chunk_id: [...] }` and aggregate by `directoryPath`.

## Integration with MCP Tools

These directory fields enable efficient implementation of directory discovery tools in the MCP server (by querying `<index>_locations`):

### Example: `discover_directories` Tool

```typescript
async function discoverDirectories(query: {
  hasReadme?: boolean;
  hasPackageJson?: boolean;
  language?: string;
  maxDepth?: number;
}) {
  const filters = [];
  
  if (query.hasReadme) {
    filters.push({ wildcard: { filePath: "*README.md" } });
  }
  
  if (query.hasPackageJson) {
    filters.push({ wildcard: { filePath: "*package.json" } });
  }
  
  if (query.language) {
    filters.push({ term: { language: query.language } });
  }
  
  const searchQuery = {
    size: 0,
    query: {
      bool: {
        filter: filters,
      }
    },
    aggs: {
      depth_filter: {
        filter: query.maxDepth ? { range: { directoryDepth: { lte: query.maxDepth } } } : { match_all: {} },
        aggs: {
          directories: {
            terms: { field: "directoryPath", size: 1000 },
            aggs: {
              file_count: { cardinality: { field: "filePath" } }
            }
          }
        }
      }
    }
  };
  
  const response = await client.search({
    index: `${indexName}_locations`,
    body: searchQuery
  });
  
  return response.aggregations.depth_filter.directories.buckets;
}
```

## Benefits

1. **Fast Discovery**: Keyword fields enable efficient aggregations on millions of documents
2. **Hierarchical Navigation**: Depth field allows exploring codebases layer by layer
3. **Package Detection**: Easy to identify significant directories with package markers
4. **LLM-Friendly**: Helps LLMs find the right starting point in large codebases (70K+ files)

## Performance Considerations

- Directory fields are indexed as `keyword` types for fast term aggregations
- Depth is stored as `integer` for efficient range queries
- The `directoryPath` field is also included in the semantic text for better search relevance
