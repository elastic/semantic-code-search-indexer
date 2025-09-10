# Semantic Code Search Indexer

This project is a high-performance code indexer designed to provide deep, contextual code intelligence for large codebases. It combines semantic search with rich metadata extraction to power advanced AI-driven development tools. The primary use case is to run on a schedule (e.g., a cron job) to keep an Elasticsearch index up-to-date with a git repository.

## Features

-   **High-Throughput Indexing**: Utilizes a multi-threaded, streaming architecture to efficiently parse and index thousands of files in parallel.
-   **Semantic Search**: Uses Elasticsearch's ELSER model to generate vector embeddings for code chunks, enabling powerful natural language search.
-   **Incremental Updates**: Can efficiently update the index by only processing files that have changed since the last indexed commit.
-   **Structured Logging**: Outputs logs in JSON format, making it easy to monitor and integrate with log management systems.
-   **Efficient `.gitignore` Handling**: Correctly applies `.gitignore` rules to exclude irrelevant files and directories.

---

## Setup and Installation

### 1. Prerequisites

-   Node.js (v20 or later)
-   npm
-   An running Elasticsearch instance (v8.0 or later) with the **ELSER model downloaded and deployed**.

### 2. Clone the Repository and Install Dependencies

```bash
git clone <repository-url>
cd code-indexer
npm install
```

### 3. Configure Environment Variables

Copy the `.env.example` file and update it with your Elasticsearch credentials.

```bash
cp .env.example .env
```

### 4. Compile the Code

The multi-threaded worker requires the project to be compiled to JavaScript.

```bash
npm run build
```

---

## Commands

### `npm run setup`

Clones a target repository into the `./.repos/` directory to prepare it for indexing.

**Arguments:**
- `<repo_url>`: The URL of the git repository to clone.

**Example:**
```bash
npm run setup -- https://github.com/elastic/kibana.git
```

### `npm run index`

Performs a full index of a codebase. This command scans a directory and populates the Elasticsearch index from scratch. It is recommended to run this with a high memory limit.

**Arguments:**
- `<directory>`: The path to the codebase to index.
- `--clean`: (Optional) Deletes the existing index before starting.

**Example:**
```bash
# Index the Kibana repo located in the .repos directory
npm run index -- .repos/kibana --clean
```

### `npm run incremental-index`

After an initial full index, use this command to efficiently update the index. It pulls the latest changes from the repository, processes only the files that have changed since the last run, and updates the Elasticsearch index.

**Arguments:**
- `<directory>`: The path to the codebase to index.

**Example:**
```bash
npm run incremental-index -- .repos/kibana
```

### `npm run index-worker`

Starts a single worker process for local development. This worker processes documents from the queue defined by the `QUEUE_DIR` environment variable.

**Arguments:**
- `--concurrency=N`: (Optional) The number of parallel tasks the worker should run.
- `--watch`: (Optional) Keeps the worker running to process new items as they are enqueued.

**Example:**
```bash
npm run index-worker -- --watch
```

### `npm run start:producer`

Starts the producer worker, which scans the repository for changes and adds them to the queue.

**Example:**
```bash
npm run start:producer
```

---
## Queue Management

These commands help you inspect and manage the document processing queues. For multi-repository deployments, you must specify which repository's queue you want to operate on.

**Important Note on `--repo-name`:**
The `--repo-name` argument should be the **simple name** of the repository's directory (e.g., `kibana`), not the full path to it. The system derives this name from the paths you configure in the `REPOSITORIES_TO_INDEX` environment variable.

### `npm run queue:monitor`

Displays statistics about a document queue, such as the number of pending, processing, and failed documents.

**Arguments:**
- `--repo-name=<repo>`: (Optional) The name of the repository queue to monitor. If omitted, it monitors the default single-user queue defined by `QUEUE_DIR`.

**Example:**
```bash
# Monitor the default queue
npm run queue:monitor

# Monitor the queue for the 'kibana' repository
npm run queue:monitor -- --repo-name=kibana
```

### `npm run queue:clear`

Deletes all documents from a queue database.

**Arguments:**
- `--repo-name=<repo>`: (Optional) The name of the repository queue to clear. If omitted, it clears the default single-user queue.

**Example:**
```bash
npm run queue:clear -- --repo-name=kibana
```

### `npm run queue:retry-failed`

Resets all documents in a queue with a `failed` status back to `pending`. This is useful for retrying documents that may have failed due to transient errors like network timeouts.

**Arguments:**
- `--repo-name=<repo>`: The name of the repository queue to operate on.

**Example:**
```bash
npm run queue:retry-failed -- --repo-name=kibana
```

### `npm run queue:list-failed`

Lists all documents in a queue that have a `failed` status, showing their ID, content size, and file path. This is useful for diagnosing "poison pill" documents that consistently fail to process.

**Arguments:**
- `--repo-name=<repo>`: The name of the repository queue to inspect.

**Example:**
```bash
npm run queue:list-failed -- --repo-name=kibana
```

---

## MCP Server Integration

This indexer is designed to work with a Model Context Protocol (MCP) server, which exposes the indexed data through a standardized set of tools for AI coding agents. The official MCP server for this project is located in a separate repository.

For information on how to set up and run the server, please visit:
[https://github.com/elastic/semantic-code-search-mcp-server](https://github.com/elastic/semantic-code-search-mcp-server)

---

## Deployment

This indexer is designed to be deployed on a server (e.g., a GCP Compute Engine VM) and run on a schedule. For detailed instructions on how to set up the indexer with `systemd` timers for a multi-repository environment, please see the [GCP Deployment Guide](./docs/GCP_DEPLOYMENT_GUIDE.md).

---

## Configuration

Configuration is managed via environment variables in a `.env` file.

| Variable | Description | Default |
| --- | --- | --- |
| `ELASTICSEARCH_ENDPOINT` | The endpoint URL for your Elasticsearch instance. | |
| `ELASTICSEARCH_CLOUD_ID` | The Cloud ID for your Elastic Cloud instance. | |
| `ELASTICSEARCH_USER` | The username for Elasticsearch authentication. | |
| `ELASTICSEARCH_PASSWORD` | The password for Elasticsearch authentication. | |
| `ELASTICSEARCH_API_KEY` | An API key for Elasticsearch authentication. | |
| `ELASTICSEARCH_INDEX` | The name of the Elasticsearch index to use. This is often set dynamically by the deployment scripts. | `code-chunks` |
| `ELASTICSEARCH_MODEL` | The name of the ELSER model to use. | `.elser_model_2` |
| `ELASTICSEARCH_LOGGING` | Whether to enable Elasticsearch client logging. | `false` |
| `QUEUE_DIR` | The directory for the queue database. Used by the `index-worker` and `clear-queue` commands. | `.queue` |
| `QUEUE_BASE_DIR` | The base directory for all multi-repo queue databases. | `.queues` |
| `BATCH_SIZE` | The number of chunks to index in a single bulk request. | `500` |
| `MAX_QUEUE_SIZE` | The maximum number of items to keep in the queue. | `1000` |
| `CPU_CORES` | The number of CPU cores to use for file parsing. | Half of the available cores |
| `MAX_CHUNK_SIZE_BYTES` | The maximum size of a code chunk in bytes. | `1000000` |
| `ENABLE_DENSE_VECTORS` | Whether to enable dense vectors for code similarity search. | `false` |
| `GIT_PATH` | The path to the `git` executable. | `git` |
| `NODE_ENV` | The node environment. | `development` |
| `LOG_FORMAT` | The format of the logs. Can be `json` or `text`. | `json` |
| `SEMANTIC_CODE_INDEXER_LANGUAGES` | A comma-separated list of languages to index. | `typescript,javascript,markdown,yaml,java,go,python` |

---

## Optional: Enabling Code Similarity Search (Dense Vectors)

This indexer supports an optional, high-fidelity "find similar code" feature powered by the `microsoft/codebert-base` model. This model generates dense vector embeddings for code chunks, which enables more nuanced, semantic similarity searches than the default ELSER model.

**Trade-offs:**
Enabling this feature has a significant performance cost. Indexing will be **substantially slower** and the Elasticsearch index will require more disk space. It is recommended to only enable this feature if the "find similar code" capability is a critical requirement for your use case.

### Setup Instructions

To enable this feature, you must perform the following manual setup steps:

**1. Install the Ingest Pipeline**

You must install a dedicated ingest pipeline in your Elasticsearch cluster. Run the following command in the **Kibana Dev Console**:

```json
PUT _ingest/pipeline/code-similarity-pipeline
{
  "description": "Pipeline to selectively generate dense vector embeddings for substantive code chunks.",
  "processors": [
    {
      "grok": {
        "field": "kind",
        "patterns": ["^(call_expression|import_statement|lexical_declaration)$"],
        "on_failure": [
          {
            "inference": {
              "model_id": "microsoft__codebert-base",
              "target_field": "code_vector",
              "field_map": {
                "content": "text_field"
              }
            }
          },
          {
            "set": {
              "field": "code_vector",
              "copy_from": "code_vector.predicted_value"
            }
          }
        ]
      }
    }
  ]
}
```

**2. Enable the Feature Flag**

Set the following environment variable in your `.env` file:

```
ENABLE_DENSE_VECTORS=true
```

**3. Re-index Your Data**

To generate the dense vectors for your codebase, you must run a full, clean index. This will apply the ingest pipeline to all of your documents.

```bash
npm run index -- .repos/your-repo --clean
```
