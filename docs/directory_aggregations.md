# Directory Aggregations

The code indexer now includes directory fields (`directoryPath`, `directoryName`, `directoryDepth`) that enable efficient directory-level aggregations and discovery.

## Directory Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `directoryPath` | `keyword` | Full directory path containing the file | `src/utils`, `packages/core/server` |
| `directoryName` | `keyword` | Name of the immediate parent directory | `utils`, `server` |
| `directoryDepth` | `integer` | Depth in the directory tree (0 for root) | `2` (for `src/utils`), `3` (for `packages/core/server`) |

## Use Cases

### 1. Discover Significant Directories

Find directories that contain important package markers:

```json
{
  "size": 0,
  "query": {
    "bool": {
      "should": [
        { "wildcard": { "filePath": "*README.md" } },
        { "wildcard": { "filePath": "*package.json" } },
        { "wildcard": { "filePath": "*__init__.py" } },
        { "wildcard": { "filePath": "*setup.py" } }
      ]
    }
  },
  "aggs": {
    "significant_directories": {
      "terms": {
        "field": "directoryPath",
        "size": 100
      },
      "aggs": {
        "file_types": {
          "terms": {
            "field": "filePath",
            "size": 10
          }
        }
      }
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
      "terms": {
        "field": "directoryPath",
        "size": 100
      }
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
  "aggs": {
    "file_types": {
      "terms": {
        "field": "language",
        "size": 20
      }
    },
    "chunk_types": {
      "terms": {
        "field": "kind",
        "size": 20
      }
    }
  }
}
```

### 4. Find Directory-Level Patterns

Discover directories with specific content patterns:

```json
{
  "size": 0,
  "query": {
    "bool": {
      "must": [
        { "match": { "content": "class definition" } },
        { "term": { "language": "python" } }
      ]
    }
  },
  "aggs": {
    "directories_with_classes": {
      "terms": {
        "field": "directoryPath",
        "size": 50
      },
      "aggs": {
        "class_count": {
          "filter": {
            "term": { "kind": "class_definition" }
          }
        }
      }
    }
  }
}
```

## Integration with MCP Tools

These directory fields enable efficient implementation of directory discovery tools in the MCP server:

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
    filters.push({ term: { filePath: "README.md" } });
  }
  
  if (query.hasPackageJson) {
    filters.push({ term: { filePath: "package.json" } });
  }
  
  if (query.language) {
    filters.push({ term: { language: query.language } });
  }
  
  const searchQuery = {
    size: 0,
    query: {
      bool: {
        filter: filters,
        ...(query.maxDepth && {
          must: [{ range: { directoryDepth: { lte: query.maxDepth } } }]
        })
      }
    },
    aggs: {
      directories: {
        terms: {
          field: "directoryPath",
          size: 1000
        },
        aggs: {
          file_count: { cardinality: { field: "filePath" } },
          languages: {
            terms: { field: "language", size: 10 }
          }
        }
      }
    }
  };
  
  const response = await client.search({
    index: indexName,
    body: searchQuery
  });
  
  return response.aggregations.directories.buckets;
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
