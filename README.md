# Semantic Code Search Indexer

This project is a high-performance code indexer designed to provide deep, contextual code intelligence for large codebases. It combines semantic search with rich metadata extraction to power advanced AI-driven development tools. The primary use case is to run on a schedule (e.g., a cron job) to keep an Elasticsearch index up-to-date with a git repository.

## Features

-   **High-Throughput Indexing**: Utilizes a multi-threaded, streaming architecture to efficiently parse and index thousands of files in parallel.
-   **Semantic Search**: Uses Elasticsearch's ELSER model to generate vector embeddings for code chunks, enabling powerful natural language search.
-   **Incremental Updates**: Can efficiently update the index by only processing files that have changed since the last indexed commit.
-   **OpenTelemetry Integration**: Built-in support for structured logging via OpenTelemetry, enabling integration with modern observability platforms.
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
- `--token <token>`: (Optional) A GitHub Personal Access Token for cloning private repositories.

**Example:**
```bash
npm run setup -- https://github.com/elastic/kibana.git

# With a token for a private repository
npm run setup -- https://github.com/my-org/my-private-repo.git --token ghp_YourTokenHere
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

Starts a single worker process to index documents from a queue.

**Arguments:**
- `--concurrency <number>`: (Optional) The number of parallel tasks the worker should run. Defaults to 1.
- `--watch`: (Optional) Keeps the worker running to process new items as they are enqueued.
- `--repoName <name>`: (Optional) The name of the repository queue to process.
- `--branch <branch>`: (Optional) The name of the branch being indexed, used for logging context.

**Example:**
```bash
# Run a single worker in watch mode
npm run index-worker -- --watch

# Run a worker for a specific repository queue
npm run index-worker -- --repoName=kibana --watch
```

### `npm run bulk:incremental-index`

Starts the producer worker, which scans the repository for changes and adds them to the queue.

**Arguments:**
- `<repo-configs...>`: A space-separated list of repository configurations in the format `"path:index[:token]"`.
- `--concurrency <number>`: (Optional) The number of parallel workers to run per repository. Defaults to 1.

**Example:**
```bash
npm run bulk:incremental-index -- path/to/my-repo:my-repo-index --concurrency 4
```

### `npm run bulk:reindex`

Performs a full clean reindex of multiple repositories. This command combines `index --clean` and worker execution for each repository, making it ideal for when you need to completely rebuild indexes (e.g., after changing the indexing format).

**Arguments:**
- `<repo-configs...>`: A space-separated list of repository configurations in the format `"path:index[:token]"`.
- `--concurrency <number>`: (Optional) The number of parallel workers to run per repository. Defaults to 1.

**Example:**
```bash
npm run bulk:reindex -- .repos/kibana:kibana-index .repos/elasticsearch:es-index --concurrency 2
```

---
## Private Repository Support

To index private GitHub repositories, you need to provide a Personal Access Token (PAT).

### Creating a GitHub Personal Access Token

The recommended and most secure method is to use a **fine-grained** PAT with read-only permissions for the specific repositories you want to index.

1.  Go to your GitHub **Settings** > **Developer settings** > **Personal access tokens** > **Fine-grained tokens**.
2.  Click **Generate new token**.
3.  Give the token a descriptive name (e.g., "Code Indexer Token").
4.  Under **Repository access**, select **Only select repositories** and choose the private repository (or repositories) you need to index.
5.  Under **Permissions**, go to **Repository permissions**.
6.  Find the **Contents** permission and select **Read-only** from the dropdown.
7.  Click **Generate token**.

### Providing the Token

You can provide the token in two ways:

1.  **As a command-line argument (for `setup`):**
    Use the `--token` option when running the `setup` command.
    ```bash
    npm run setup -- <private-repo-url> --token <your-token>
    ```

2.  **In the `.env` file (for scheduled indexing):**
    For the scheduled `start:producer` command, you can add the token to the `REPOSITORIES_TO_INDEX` variable in your `.env` file. The format is `path:index:token`.

    ```
    # .env file
    REPOSITORIES_TO_INDEX="/path/to/repo-one:index-one:ghp_TokenOne /path/to/repo-two:index-two:ghp_TokenTwo"
    ```

    You can also set a global `GITHUB_TOKEN` in your `.env` file as a fallback.

    ```
    # .env file
    GITHUB_TOKEN=ghp_YourGlobalToken
    ```

---
## Queue Management

These commands help you inspect and manage the document processing queues. For multi-repository deployments, you must specify which repository's queue you want to operate on.

**Important Note on `--repoName`:**
The `--repoName` argument should be the **simple name** of the repository's directory (e.g., `kibana`), not the full path to it. The system derives this name from the paths you configure in the `REPOSITORIES_TO_INDEX` environment variable.

### `npm run queue:monitor`

Displays statistics about a document queue, such as the number of pending, processing, and failed documents.

**Arguments:**
- `--repoName=<repo>`: (Optional) The name of the repository queue to monitor. If omitted, it monitors the default single-user queue defined by `QUEUE_DIR`.

**Example:**
```bash
# Monitor the default queue
npm run queue:monitor

# Monitor the queue for the 'kibana' repository
npm run queue:monitor -- --repoName=kibana
```

### `npm run queue:clear`

Deletes all documents from a queue database.

**Arguments:**
- `--repoName=<repo>`: (Optional) The name of the repository queue to clear. If omitted, it clears the default single-user queue.

**Example:**
```bash
npm run queue:clear -- --repoName=kibana
```

### `npm run queue:retry-failed`

Resets all documents in a queue with a `failed` status back to `pending`. This is useful for retrying documents that may have failed due to transient errors like network timeouts.

**Arguments:**
- `--repoName=<repo>`: The name of the repository queue to operate on.

**Example:**
```bash
npm run queue:retry-failed -- --repoName=kibana
```

### `npm run queue:list-failed`

Lists all documents in a queue that have a `failed` status, showing their ID, content size, and file path. This is useful for diagnosing "poison pill" documents that consistently fail to process.

**Arguments:**
- `--repoName=<repo>`: The name of the repository queue to inspect.

**Example:**
```bash
npm run queue:list-failed -- --repoName=kibana
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
| `OTEL_LOGGING_ENABLED` | Enable OpenTelemetry logging. | `false` |
| `OTEL_METRICS_ENABLED` | Enable OpenTelemetry metrics (defaults to same as `OTEL_LOGGING_ENABLED`). | Same as `OTEL_LOGGING_ENABLED` |
| `OTEL_SERVICE_NAME` | Service name for OpenTelemetry logs and metrics. | `semantic-code-search-indexer` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector endpoint for both logs and metrics. | `http://localhost:4318` |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Logs-specific OTLP endpoint (overrides OTEL_EXPORTER_OTLP_ENDPOINT). | |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Metrics-specific OTLP endpoint (overrides OTEL_EXPORTER_OTLP_ENDPOINT). | |
| `OTEL_EXPORTER_OTLP_HEADERS` | Headers for OTLP exporter (e.g., `authorization=Bearer token`). | |
| `OTEL_METRIC_EXPORT_INTERVAL_MILLIS` | Interval in milliseconds between metric exports. | `60000` (60 seconds) |
| `QUEUE_DIR` | The directory for the queue database. Used by the `index-worker` and `clear-queue` commands. | `.queue` |
| `QUEUE_BASE_DIR` | The base directory for all multi-repo queue databases. | `.queues` |
| `BATCH_SIZE` | The number of chunks to index in a single bulk request. | `500` |
| `MAX_QUEUE_SIZE` | The maximum number of items to keep in the queue. | `1000` |
| `CPU_CORES` | The number of CPU cores to use for file parsing. | Half of the available cores |
| `MAX_CHUNK_SIZE_BYTES` | The maximum size of a code chunk in bytes. | `1000000` |
| `DEFAULT_CHUNK_LINES` | Number of lines per chunk for line-based parsing (JSON, YAML, text without paragraphs). | `15` |
| `CHUNK_OVERLAP_LINES` | Number of overlapping lines between chunks in line-based parsing. | `3` |
| `ENABLE_DENSE_VECTORS` | Whether to enable dense vectors for code similarity search. | `false` |
| `GIT_PATH` | The path to the `git` executable. | `git` |
| `NODE_ENV` | The node environment. | `development` |
| `SEMANTIC_CODE_INDEXER_LANGUAGES` | A comma-separated list of languages to index. | `typescript,javascript,markdown,yaml,java,go,python` |

### Chunking Strategy by File Type

The indexer uses different chunking strategies depending on file type to optimize for both semantic search quality and LLM context window limits:

- **JSON**: Always uses line-based chunking with configurable chunk size (`DEFAULT_CHUNK_LINES`) and overlap (`CHUNK_OVERLAP_LINES`). This prevents large JSON values from creating oversized chunks.
- **YAML**: Always uses line-based chunking with the same configuration. This provides more context than single-line chunks while maintaining manageable sizes.
- **Text files**: Uses paragraph-based chunking (splitting on double newlines) when paragraphs are detected. Falls back to line-based chunking for continuous text without paragraph breaks.
- **Markdown**: Always uses paragraph-based chunking to preserve logical document structure.
- **Code files** (TypeScript, JavaScript, Python, Java, Go, etc.): Uses tree-sitter based parsing to extract functions, classes, and other semantic units.

---

## OpenTelemetry Integration

This indexer supports comprehensive OpenTelemetry integration for both **logs** and **metrics**, enabling deep observability into indexing operations. Telemetry data is sent via OTLP/HTTP protocol to an OpenTelemetry Collector, which routes it to various backends (Elasticsearch, Prometheus, etc.).

### Console Logging

By default, the indexer outputs text-format logs to the console (except when `NODE_ENV=test`):

```
[2025-10-16T10:30:45.123Z] [INFO] Successfully indexed 500 files
[2025-10-16T10:30:45.234Z] [ERROR] Failed to parse file: syntax error
```

### Enabling OpenTelemetry Export

To enable OpenTelemetry log and metrics export:

```bash
OTEL_LOGGING_ENABLED=true
OTEL_METRICS_ENABLED=true  # Optional, defaults to same as OTEL_LOGGING_ENABLED
OTEL_SERVICE_NAME=my-indexer  # Optional, defaults to 'semantic-code-search-indexer'
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

For authentication to the collector:

```bash
OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer your-token"
```

You can also configure separate endpoints for logs and metrics:

```bash
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://otel-collector:4318/v1/logs
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://otel-collector:4318/v1/metrics
```

### Resource Attributes

The following resource attributes are automatically attached to all logs and metrics:
- `service.name`: Service name (from `OTEL_SERVICE_NAME`)
- `service.version`: Version from package.json
- `deployment.environment`: From `NODE_ENV`
- `host.name`, `host.arch`, `host.type`, `os.type`: Host information

### Log and Metric Attributes

Each log entry and metric includes attributes based on context:
- `repo.name`: Repository being indexed (e.g., "kibana", "elasticsearch")
- `repo.branch`: Branch being indexed (e.g., "main", "feature/metrics")
- Custom metadata passed to logging calls or metric recordings

### Available Metrics

The indexer exports the following metrics for monitoring indexing operations:

#### Parser Metrics

| Metric | Type | Description | Attributes |
|--------|------|-------------|-----------|
| `parser.files.processed` | Counter | Total files processed | `language`, `status`, `repo.name`, `repo.branch` |
| `parser.files.failed` | Counter | Files that failed to parse | `language`, `status`, `repo.name`, `repo.branch` |
| `parser.chunks.created` | Counter | Total chunks created | `language`, `parser_type`, `repo.name`, `repo.branch` |
| `parser.chunks.skipped` | Counter | Chunks skipped due to exceeding maxChunkSizeBytes | `language`, `parser_type`, `size`, `repo.name`, `repo.branch` |
| `parser.chunks.size` | Histogram | Distribution of chunk sizes (bytes) | `language`, `parser_type`, `repo.name`, `repo.branch` |

#### Queue Metrics

| Metric | Type | Description | Attributes |
|--------|------|-------------|-----------|
| `queue.documents.enqueued` | Counter | Documents added to queue | `repo.name`, `repo.branch` |
| `queue.documents.dequeued` | Counter | Documents removed from queue | `repo.name`, `repo.branch` |
| `queue.documents.committed` | Counter | Successfully indexed documents | `repo.name`, `repo.branch` |
| `queue.documents.requeued` | Counter | Documents requeued after failure | `repo.name`, `repo.branch` |
| `queue.documents.failed` | Counter | Documents marked as failed | `repo.name`, `repo.branch` |
| `queue.documents.deleted` | Counter | Documents deleted from queue | `repo.name`, `repo.branch` |
| `queue.size.pending` | Gauge | Current pending documents | `repo.name`, `repo.branch`, `status` |
| `queue.size.processing` | Gauge | Current processing documents | `repo.name`, `repo.branch`, `status` |
| `queue.size.failed` | Gauge | Current failed documents | `repo.name`, `repo.branch`, `status` |

#### Indexer Metrics

| Metric | Type | Description | Attributes |
|--------|------|-------------|-----------|
| `indexer.batch.processed` | Counter | Successful batches indexed | `repo.name`, `repo.branch`, `concurrency` |
| `indexer.batch.failed` | Counter | Failed batches | `repo.name`, `repo.branch`, `concurrency` |
| `indexer.batch.duration` | Histogram | Batch processing time (ms) | `repo.name`, `repo.branch`, `concurrency` |
| `indexer.batch.size` | Histogram | Distribution of batch sizes | `repo.name`, `repo.branch`, `concurrency` |

### Repository-Specific Dashboards

All metrics and logs include `repo.name` and `repo.branch` attributes, enabling you to:
- Filter telemetry data by repository and branch
- Create repository-specific dashboards in Kibana
- Set up alerts for specific repositories
- Compare indexing performance across repositories

Example Kibana query to filter by repository:
```
repo.name: "kibana" AND repo.branch: "main"
```

### OpenTelemetry Collector Configuration

A complete example collector configuration is provided in [`docs/otel-collector-config.yaml`](./docs/otel-collector-config.yaml). This configuration:
- Receives logs and metrics via OTLP/HTTP
- Batches telemetry data for efficiency
- Adds host resource attributes
- Exports logs to `logs-semanticcode.otel-default` index
- Exports metrics to `metrics-semanticcode.otel-default` index
- Supports authentication to Elasticsearch
- **Configured with `mapping: mode: otel`** for proper histogram support (requires Elasticsearch 8.12+)

**Important:** The indexer configures metrics with **Delta temporality**, which is required by the Elasticsearch exporter for histogram metrics. Without this configuration, histograms (`parser.chunks.size`, `indexer.batch.duration`, `indexer.batch.size`) will be silently dropped.

**Note on Histogram Visibility:** OpenTelemetry histogram metrics are stored as complex nested structures in Elasticsearch and may not appear in Kibana's field list or be easily queryable via ES|QL. This is a known limitation of Kibana's histogram support. Histograms are still indexed and can be accessed via direct Elasticsearch queries or specialized visualizations.

To use the example configuration:

```bash
export ELASTICSEARCH_ENDPOINT=https://elasticsearch:9200
export ELASTICSEARCH_API_KEY=your-api-key

docker run -p 4318:4318 -p 4317:4317 -p 13133:13133 \
  -e ELASTICSEARCH_ENDPOINT \
  -e ELASTICSEARCH_API_KEY \
  -v $(pwd)/docs/otel-collector-config.yaml:/etc/otelcol/config.yaml \
  otel/opentelemetry-collector-contrib:latest
```

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
