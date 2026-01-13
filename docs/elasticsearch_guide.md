# Elasticsearch Integration Guide

This document provides a comprehensive guide for connecting to, understanding, and utilizing the Elasticsearch index created by the `code-indexer` tool. It is intended for developers building a complimentary MCP server that will interact with the indexed code data.

## Connecting to Elasticsearch

The `code-indexer` tool uses the official Elasticsearch Node.js client. Connection is configured through the following environment variables:

| Environment Variable | Description |
| :--- | :--- |
| `ELASTICSEARCH_ENDPOINT` | The HTTP endpoint of your Elasticsearch cluster. |
| `ELASTICSEARCH_CLOUD_ID` | The Cloud ID for an Elastic Cloud deployment. |
| `ELASTICSEARCH_USER` | The username for authentication. |
| `ELASTICSEARCH_PASSWORD` | The password for authentication. |
| `ELASTICSEARCH_API_KEY` | An API key for authentication. |

You can use either `ELASTICSEARCH_ENDPOINT` for a self-hosted cluster or `ELASTICSEARCH_CLOUD_ID` for an Elastic Cloud deployment. You can authenticate with either a username/password combination or an API key.

### Example Connection (Node.js)

```javascript
const { Client } = require('@elastic/elasticsearch');

const client = new Client({
  cloud: {
    id: process.env.ELASTICSEARCH_CLOUD_ID,
  },
  auth: {
    username: process.env.ELASTICSEARCH_USER,
    password: process.env.ELASTICSEARCH_PASSWORD,
  },
  // Or, for API key authentication:
  // auth: {
  //   apiKey: process.env.ELASTICSEARCH_API_KEY,
  // }
});
```

## Index Schema

The `code-indexer` creates multiple Elasticsearch indices, derived from the base index name specified by `ELASTICSEARCH_INDEX` (defaulting to `code-chunks`):

- `<index>` (e.g. `code-chunks`): primary chunk index (semantic search + metadata)
- `<index>_settings` (e.g. `code-chunks_settings`): small settings/state index (e.g. last indexed commit per branch)
- `<index>_locations` (e.g. `code-chunks_locations`): dedicated per-file location index (one document per chunk occurrence)

### Index Mapping

Here is the mapping for the `code-chunks` index:

```json
{
  "mappings": {
    "properties": {
      "type": { "type": "keyword" },
      "language": { "type": "keyword" },
      "kind": { "type": "keyword" },
      "imports": {
        "type": "nested",
        "properties": {
          "path": { "type": "keyword" },
          "type": { "type": "keyword" },
          "symbols": { "type": "keyword" }
        }
      },
      "symbols": {
        "type": "nested",
        "properties": {
          "name": { "type": "keyword" },
          "kind": { "type": "keyword" },
          "line": { "type": "integer" }
        }
      },
      "exports": {
        "type": "nested",
        "properties": {
          "name": { "type": "keyword" },
          "type": { "type": "keyword" },
          "target": { "type": "keyword" }
        }
      },
      "containerPath": { "type": "text" },
      "chunk_hash": { "type": "keyword" },
      "content": { "type": "text" },
      "semantic_text": { "type": "semantic_text" },
      "created_at": { "type": "date" },
      "updated_at": { "type": "date" }
    }
  }
}
```

### Field Descriptions

| Field | Type | Description |
| :--- | :--- | :--- |
| `type` | `keyword` | The type of the code chunk (e.g., 'class', 'function'). |
| `language` | `keyword` | The programming language of the code. |
| `kind` | `keyword` | The specific kind of the code symbol (from LSP). |
| `imports` | `nested` | Import metadata (path, type, imported symbols). |
| `symbols` | `nested` | Extracted symbol metadata (name, kind, line). |
| `exports` | `nested` | Export metadata (named/default/namespace). |
| `containerPath` | `text` | The path of the containing symbol (e.g., class name for a method). |
| `chunk_hash` | `keyword` | A hash of the content of the code chunk. |
| `content` | `text` | The raw source code of the chunk. |
| `semantic_text` | `semantic_text` | Semantic search field populated via Elasticsearch inference at ingest time. Note: it does **not** include file paths/directories; those live in `<index>_locations`. |
| `created_at` | `date` | The timestamp when the document was created. |
| `updated_at` | `date` | The timestamp when the document was last updated. |

### Locations index (`<index>_locations`)

To avoid “mega-documents” for boilerplate chunks (license headers, common imports, etc.), the indexer writes **one document per chunk occurrence** into `<index>_locations`.

- `chunk_id` is the **`_id` of the chunk document** in the primary index (stable sha256 identity).
- This store is the single source of truth for file paths, line ranges, directory fields, and git metadata.

Example mapping (high-level):

```json
{
  "mappings": {
    "properties": {
      "chunk_id": { "type": "keyword" },
      "filePath": { "type": "wildcard" },
      "startLine": { "type": "integer" },
      "endLine": { "type": "integer" },
      "directoryPath": { "type": "keyword", "eager_global_ordinals": true },
      "directoryName": { "type": "keyword" },
      "directoryDepth": { "type": "integer" },
      "git_file_hash": { "type": "keyword" },
      "git_branch": { "type": "keyword" },
      "updated_at": { "type": "date" }
    }
  }
}
```

## How to Use the Index

The primary intended use of this index is semantic search over the codebase. The index uses Elasticsearch’s `semantic_text` field type to perform ELSER-backed semantic queries.

### Semantic Search

To perform a semantic search, use a `semantic` query against the `semantic_text` field.

#### Example Search Query (Node.js)

```javascript
async function searchCode(query) {
  const response = await client.search({
    index: 'code-chunks', // Or process.env.ELASTICSEARCH_INDEX
    query: {
      semantic: {
        field: 'semantic_text',
        query,
      }
    },
  });

  return response.hits.hits.map((hit) => ({
    ...hit._source,
    score: hit._score,
  }));
}
```

### Other Queries

While the primary focus is on semantic search, you can also perform traditional Elasticsearch queries on the other fields. For example, you can filter chunk docs by `language` or `kind`.

For file-path filtering, query `<index>_locations` by `filePath` and join back to chunk docs using `chunk_id` (via `mget`).

### Joining chunk docs to file locations (important)

The indexer stores content-deduplicated chunk documents in `<index>` and per-file occurrences in `<index>_locations`:

- Query `<index>_locations` to find relevant occurrences (by `filePath`, directory fields, etc.).
- Use the resulting `chunk_id` values to fetch chunk documents from `<index>` (`mget`).

### Important Considerations

*   **ELSER Model / inference:** The `semantic_text` field is configured with an `inference_id`. Configure this via `ELASTICSEARCH_INFERENCE_ID` (or legacy `ELASTICSEARCH_MODEL`).
*   **Index Name:** Always use the `ELASTICSEARCH_INDEX` environment variable to refer to the index name to avoid mismatches.
*   **Data Freshness:** The index is updated by running the `code-indexer` tool. For the MCP server to have the latest data, the index needs to be kept up-to-date by running the indexer regularly.
