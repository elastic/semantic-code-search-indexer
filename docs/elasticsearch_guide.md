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

The `code-indexer` creates an index with the name specified by the `ELASTICSEARCH_INDEX` environment variable (defaulting to `code-chunks`). This index stores parsed code chunks and their metadata.

### Index Mapping

Here is the mapping for the `code-chunks` index:

```json
{
  "mappings": {
    "properties": {
      "type": { "type": "keyword" },
      "language": { "type": "keyword" },
      "kind": { "type": "keyword" },
      "imports": { "type": "keyword" },
      "containerPath": { "type": "text" },
      "filePath": { "type": "keyword" },
      "directoryPath": { "type": "keyword", "eager_global_ordinals": true },
      "directoryName": { "type": "keyword" },
      "directoryDepth": { "type": "integer" },
      "git_file_hash": { "type": "keyword" },
      "git_branch": { "type": "keyword" },
      "chunk_hash": { "type": "keyword" },
      "startLine": { "type": "integer" },
      "endLine": { "type": "integer" },
      "content": { "type": "text" },
      "content_embedding": { "type": "sparse_vector" },
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
| `imports` | `keyword` | A list of imported modules or libraries. |
| `containerPath` | `text` | The path of the containing symbol (e.g., class name for a method). |
| `filePath` | `keyword` | The repository-relative path to the source file. |
| `directoryPath` | `keyword` | The directory path containing the file (e.g., 'src/utils'). Optimized with eager global ordinals for fast aggregations. |
| `directoryName` | `keyword` | The name of the immediate parent directory. |
| `directoryDepth` | `integer` | The depth of the directory in the file tree (0 for root-level files). |
| `git_file_hash` | `keyword` | The Git hash of the file content. |
| `git_branch` | `keyword` | The Git branch the file belongs to. |
| `chunk_hash` | `keyword` | A hash of the content of the code chunk. |
| `startLine` | `integer` | The starting line number of the chunk in the file. |
| `endLine` | `integer` | The ending line number of the chunk in the file. |
| `content` | `text` | The raw source code of the chunk. |
| `content_embedding` | `sparse_vector` | The ELSER semantic embedding of the `content`. |
| `created_at` | `date` | The timestamp when the document was created. |
| `updated_at` | `date` | The timestamp when the document was last updated. |

## How to Use the Index

The primary intended use of this index is for semantic search over the codebase. The `code-indexer` uses the **ELSER (Elastic Learned Sparse EncodeR)** model to generate semantic embeddings for each code chunk.

### Semantic Search

To perform a semantic search, you should use a `sparse_vector` query on the `content_embedding` field. This will find code chunks that are semantically similar to your query string.

#### Example Search Query (Node.js)

```javascript
async function searchCode(query) {
  const response = await client.search({
    index: 'code-chunks', // Or process.env.ELASTICSEARCH_INDEX
    query: {
      sparse_vector: {
        field: 'content_embedding',
        inference_id: '.elser-2-elastic', // Or process.env.ELASTICSEARCH_MODEL
        query: query,
      },
    },
  });

  return response.hits.hits.map((hit) => ({
    ...hit._source,
    score: hit._score,
  }));
}
```

### Other Queries

While the primary focus is on semantic search, you can also perform traditional Elasticsearch queries on the other fields. For example, you could filter by `language`, `filePath`, or `kind`.

### Important Considerations

*   **ELSER Model:** The `semantic_text` field in the index is configured with an `inference_id` that specifies which ELSER model to use for generating embeddings. Ensure that the ELSER model is available in your Elasticsearch cluster. The model ID is configurable via the `ELASTICSEARCH_MODEL` environment variable (defaulting to `.elser-2-elastic`).
*   **Index Name:** Always use the `ELASTICSEARCH_INDEX` environment variable to refer to the index name to avoid mismatches.
*   **Data Freshness:** The index is updated by running the `code-indexer` tool. For the MCP server to have the latest data, the index needs to be kept up-to-date by running the indexer regularly.
