⚠️ **Warning: Unstable `main` branch** ⚠️

Until we settle on a stable release/versioning process with backwards-compatibility guarantees,
**`main` may contain breaking changes at any moment** (CLI flags, env vars, index mappings, queue schema, etc.).

If you deploy this, **pin to a specific commit SHA** and upgrade intentionally.

If you want an older, known-good version from **October 2025 (pre–most breaking changes)** that is compatible with
the current MCP Docker image, use this pairing:

- **Indexer**: commit `2fe4a9a4fefe84252a9c5ffe95875162bdb79cd0` (on `main`)
- **MCP**: `simianhacker/semantic-code-search-mcp-server:latest`

# Semantic Code Search Indexer

This project is a high-performance code indexer designed to provide deep, contextual code intelligence for large codebases. It combines semantic search with rich metadata extraction to power advanced AI-driven development tools. The primary use case is to run on a schedule (e.g., a cron job) to keep an Elasticsearch index up-to-date with a git repository.

## Features

- **High-Throughput Indexing**: Utilizes a multi-threaded, streaming architecture to efficiently parse and index thousands of files in parallel.
- **Semantic Search**: Uses Elasticsearch's ELSER model to generate vector embeddings for code chunks, enabling powerful natural language search.
- **Incremental Updates**: Can efficiently update the index by only processing files that have changed since the last indexed commit.
- **OpenTelemetry Integration**: Built-in support for structured logging via OpenTelemetry, enabling integration with modern observability platforms.
- **Efficient `.gitignore` Handling**: Correctly applies `.gitignore` rules to exclude irrelevant files and directories.

---

## Local setup (recommended)

### Prerequisites

- Node.js v20+ (check with `node -v`)
- Elasticsearch 8.0+
  - For **semantic search** (the default), your cluster must have **ELSER inference** available and you must set `SCSI_ELASTICSEARCH_INFERENCE_ID`.
  - If you want to run without semantic inference (e.g. for local testing), set `SCSI_DISABLE_SEMANTIC_TEXT=true`.
  - Connection credentials use standard env var names: `ELASTICSEARCH_ENDPOINT`, `ELASTICSEARCH_CLOUD_ID`, `ELASTICSEARCH_API_KEY`, etc.
    - This disables the `semantic_text` mapping at index creation time, so semantic search queries (including the `search` command and the MCP server’s semantic tools) will not work for that index.
    - To re-enable semantic search later, recreate the index with semantic text enabled and reindex.
- Elasticsearch credentials (API key recommended)

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Build the project
npm run build

# 3. Configure Elasticsearch connection
cp .env.example .env
# Edit .env with your Elasticsearch connection details:
# - Recommended (Elastic Cloud): set ELASTICSEARCH_CLOUD_ID + ELASTICSEARCH_API_KEY
# - Self-managed: set ELASTICSEARCH_ENDPOINT + credentials (username/password or API key)

# 4. Recommended: Elastic Cloud + EIS (best default performance)
# - Create an Elastic Cloud deployment/project
# - Copy its Cloud ID into ELASTICSEARCH_CLOUD_ID
# - Create an API key and set it as ELASTICSEARCH_API_KEY
# - Set SCSI_ELASTICSEARCH_INFERENCE_ID=.elser-2-elastic (EIS-backed ELSER endpoint)

# 5. (Optional) Add .indexerignore to your repository
# Copy .indexerignore.example to your repo as .indexerignore to exclude files
# This reduces indexing time and improves relevance by excluding tests, build artifacts, etc.

# 6. Index your repository
npm run index -- /path/to/your/repo --clean
```

---

## Docker (optional)

The indexer is also published as a Docker image:

- `docker.elastic.co/observability-ci/scsi`

**macOS note:** Docker Desktop runs Linux containers inside a VM. If you index large repos, you may need to increase
CPU/RAM limits in Docker Desktop settings; bind-mounted filesystem performance can also be significantly slower than
running locally or on a Linux VM/server.

**Tag guidance (important):**

- Prefer **pinning to a SHA tag** in the form `sha-<7-char-git-sha>` for deployments.
- Do not rely on floating tags for automation.

**Quick start (index a remote repo URL):**

```bash
SCSI_SHA="<7-char-git-sha>"
SCSI_IMAGE="docker.elastic.co/observability-ci/scsi:sha-${SCSI_SHA}"

mkdir -p .repos .queues
cp .env.example .env

docker run --rm \
  --env-file .env \
  -v "$PWD/.repos:/app/.repos" \
  -v "$PWD/.queues:/app/.queues" \
  "$SCSI_IMAGE" index https://github.com/elastic/kibana.git --pull
```

**Notes:**

- The bind mounts persist clones (`./.repos`) and queue state (`./.queues`) across runs.
- For private repos: set `GITHUB_TOKEN` (or pass `--github-token` to override for one run).

### MCP server (separate repository)

The MCP server should be accessed **only via Docker** (stability + ease). See the MCP server repository for the
recommended Docker image/tag and configuration:

- `elastic/semantic-code-search-mcp-server`: https://github.com/elastic/semantic-code-search-mcp-server

### Excluding Files with `.indexerignore`

The indexer respects both `.gitignore` and `.indexerignore` files in your repository. Create a `.indexerignore` file in the root of the repository you're indexing to exclude additional files beyond what's in `.gitignore`.

**Example use cases:**

- Exclude test files (`**/*.test.ts`, `**/*.spec.js`)
- Skip build artifacts (`target/`, `dist/`, `build/`)
- Ignore large generated files or documentation

See `.indexerignore.example` in this repository for a complete example tailored for large repositories like Kibana.

---

## Commands

### `npm run setup`

Clones a target repository into the `./.repos/` directory to prepare it for indexing.

**Arguments:**

- `<repo_url>` - The URL of the git repository to clone

**Options:**

- `--github-token <token>` - GitHub token for cloning/pulling private repositories (overrides `GITHUB_TOKEN`)

**Examples:**

```bash
npm run setup -- https://github.com/elastic/kibana.git

# Private repository (requires GITHUB_TOKEN)
GITHUB_TOKEN=ghp_YourTokenHere npm run setup -- https://github.com/my-org/my-private-repo.git

# Private repository (token override for this run)
npm run setup -- https://github.com/my-org/my-private-repo.git --github-token ghp_YourTokenHere
```

### `npm run index`

Indexes one or more repositories by scanning the codebase, enqueuing code chunks, and processing them to Elasticsearch. This unified command handles both scanning and indexing in a single operation.

**Arguments:**

- `[repos...]` - One or more repository paths, names, or URLs (format: `repo[:index]`).
- `--clean` - Delete existing Elasticsearch index before starting (full rebuild)
- `--pull` - Git pull before indexing
- `--github-token <token>` - GitHub token for cloning/pulling private repositories (overrides `GITHUB_TOKEN`)
- `--watch` - Keep indexer running after processing queue (for continuous indexing)
- `--concurrency <number>` - Number of parallel Elasticsearch indexing workers (default: 2)
- `--batch-size <number>` - Number of chunks per Elasticsearch bulk request (default: 100)
- `--delete-documents-page-size <number>` - PIT pagination size for incremental deletion scans (default: 500)
- `--parse-concurrency <number>` - Maximum parallel file parsing jobs (default: half your CPU cores)
- `--languages <names>` - Comma-separated list of languages to index (default: `SCSI_LANGUAGES` if set, otherwise all languages)
- `--branch <branch>` - Branch name for logging/metadata (default: auto-detect)

**Validation:** `--concurrency`, `--batch-size`, `--delete-documents-page-size`, and `--parse-concurrency` must be **positive integers**. Invalid values fail fast with a clear error message.

**Important:** The default values for `--concurrency`, `--batch-size`, and `--parse-concurrency` are intentionally conservative. They are chosen to reduce throttling, timeouts, and indexing failures across typical environments (local and remote). Only change them if you understand the trade-offs and have a measured reason to tune.

**Examples:**

```bash
# Basic usage - index a local repository
npm run index -- /path/to/repo

# Index with watch mode (keeps running for continuous updates)
npm run index -- /path/to/repo --watch

# Index a remote repository (clones automatically)
npm run index -- https://github.com/elastic/kibana.git --clean

# Index with custom Elasticsearch index name
npm run index -- /path/to/repo:my-custom-index

# Index multiple repositories sequentially
npm run index -- /path/to/repo1 /path/to/repo2

# Incremental update (only changed files)
npm run index -- /path/to/repo --pull

# Private repository (requires GITHUB_TOKEN)
GITHUB_TOKEN=ghp_YourTokenHere npm run index -- https://github.com/org/private-repo.git --pull

# Private repository (token override for this run)
npm run index -- https://github.com/org/private-repo.git --pull --github-token ghp_YourTokenHere
```

**How It Works:**

1. **Scan Phase**: Parses files and enqueues code chunks to a SQLite queue
2. **Index Phase**: Worker processes the queue and sends documents to Elasticsearch
3. **Watch Mode** (optional): Worker continues running to process new items as they arrive

**Incremental vs. Full Indexing:**

- Without `--clean`: Automatically detects if this is a first-time index or an incremental update
  - If no previous index exists, performs a full index
  - If previous index exists, only processes changed files since last indexed commit
- With `--clean`: Always performs a full rebuild, deleting the existing index first

### `npm run search`

Runs a **semantic** search query against an existing index and prints the top matching chunks.

**Arguments:**

- `<query>` - Natural language search query

**Options:**

- `--index <index>` - **Required.** Elasticsearch index to search
- `--limit <number>` - Maximum number of results to display (default: `10`)

**Help:**

Because this is an `npm run` script, you must include `--` to pass flags through to the underlying command:

```bash
npm run search -- --help
```

**Notes:**

- The `search` command requires the target index to have a `semantic_text` mapping.
  - If the index was created with `SCSI_DISABLE_SEMANTIC_TEXT=true`, semantic search (including `npm run search`) will not work for that index until you recreate the index with semantic text enabled and reindex.
- If the index does not exist, the command fails with a clear `Index "<name>" does not exist` error.

**Examples:**

```bash
npm run search -- "how does the queue retry work?" --index code-chunks
npm run search -- "otel exporter endpoint" --index code-chunks --limit 5
```

### `npm run scaffold-language`

Generates a new language configuration file from templates. This command simplifies adding new language support by automatically creating properly formatted configuration files and optionally registering them in the language index.

**Arguments:**

- `--name <name>` - Language name (lowercase, no spaces, alphanumeric with underscores)
- `--extensions <extensions>` - File extensions (comma-separated, e.g., ".rs,.rlib")
- `--parser <parser>` - Tree-sitter package name (e.g., tree-sitter-rust)
- `--custom` - Use custom parser (no tree-sitter)
- `--no-register` - Skip auto-registration in index.ts

**Examples:**

```bash
# Create a new tree-sitter language
npx ts-node src/index.ts scaffold-language --name rust --extensions ".rs,.rlib" --parser tree-sitter-rust

# Create a custom parser language (for markup/template languages)
npx ts-node src/index.ts scaffold-language --name toml --extensions ".toml" --custom

# Skip auto-registration in index.ts
npx ts-node src/index.ts scaffold-language --name proto --extensions ".proto" --parser tree-sitter-proto --no-register
```

The command will:

1. Generate a language configuration file in `src/languages/`
2. Validate the configuration for common errors
3. Optionally register the language in `src/languages/index.ts`
4. Provide clear next steps for completing the language setup

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

Set `GITHUB_TOKEN` in your environment (or in a `.env` file) before running `setup` or `index`:

    ```
    # .env file
    GITHUB_TOKEN=ghp_YourGlobalToken
    ```

You can also pass `--github-token` to `setup` or `index` to override `GITHUB_TOKEN` for a single invocation.

---

## Queue Management

These commands help you inspect and manage the document processing queues. For multi-repository deployments, you must specify which repository's queue you want to operate on.

**Important Note on `--repo-name`:**
The `--repo-name` argument should be the **simple name** of the repository's directory (e.g., `kibana`), not the full path to it.

### `npm run queue:monitor`

Check queue status - how many documents are pending, processing, or failed.

**Options:**

- `--repo-name <repoName>` - Repository name (auto-detects if only one repo exists)

**Examples:**

```bash
# Auto-detect repository (if only one exists)
npm run queue:monitor

# Specify repository
npm run queue:monitor -- --repo-name=elasticsearch-js
```

### `npm run queue:clear`

Delete all documents from the queue (useful for starting fresh).

**Options:**

- `--repo-name <repoName>` - Repository name (auto-detects if only one repo exists)

**Examples:**

```bash
# Auto-detect repository (if only one exists)
npm run queue:clear

# Specify repository
npm run queue:clear -- --repo-name=elasticsearch-js
```

**Pro tip:** Run `watch -n 5 'npm run queue:monitor'` to continuously monitor the queue.

### `npm run queue:retry-failed`

Resets all documents in a queue with a `failed` status back to `pending`. This is useful for retrying documents that may have failed due to transient errors like network timeouts.

**Options:**

- `--repo-name <repoName>` - Repository name (auto-detects if only one repo exists)

**Examples:**

```bash
# Auto-detect repository (if only one exists)
npm run queue:retry-failed

# Specify repository
npm run queue:retry-failed -- --repo-name=elasticsearch-js
```

### `npm run queue:list-failed`

Lists all documents in a queue that have a `failed` status, showing their ID, content size, and file path. This is useful for diagnosing "poison pill" documents that consistently fail to process.

**Options:**

- `--repo-name <repoName>` - Repository name (auto-detects if only one repo exists)

**Examples:**

```bash
# Auto-detect repository (if only one exists)
npm run queue:list-failed

# Specify repository
npm run queue:list-failed -- --repo-name=elasticsearch-js
```

---

## MCP Server Integration

This indexer is designed to work with a Model Context Protocol (MCP) server, which exposes the indexed data through a standardized set of tools for AI coding agents. The official MCP server for this project is located in a separate repository.

The MCP server should be accessed **only via Docker** (stability + ease). For information on how to set it up and run it, please visit:
[https://github.com/elastic/semantic-code-search-mcp-server](https://github.com/elastic/semantic-code-search-mcp-server)

---

## Deployment

This indexer is designed to be deployed on a server (e.g., a GCP Compute Engine VM) and run on a schedule. For detailed instructions on how to set up the indexer with `systemd` timers for a multi-repository environment, please see the [GCP Deployment Guide](./docs/GCP_DEPLOYMENT_GUIDE.md).

---

## Configuration

Configuration is managed via environment variables loaded from a `.env` file.

**Environment file loading:**

- Loads `.env` from the indexer’s root.
- When `NODE_ENV=test`, loads `.env.test` instead.

### Elasticsearch indices created

Given a base index name (from CLI `repo[:index]`), the indexer creates and maintains:

- `<index>`: the primary chunk index (semantic search + metadata)
- `<index>_settings`: small settings/state index (e.g. last indexed commit per branch)
- `<index>_locations`: dedicated per-file location index (one document per chunk occurrence)

| Variable                                   | Description                                                                                                                                     | Default                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `ELASTICSEARCH_ENDPOINT`                   | The endpoint URL for your Elasticsearch instance.                                                                                               |                                     |
| `ELASTICSEARCH_CLOUD_ID`                   | The Cloud ID for your Elastic Cloud instance.                                                                                                   |                                     |
| `ELASTICSEARCH_USERNAME`                   | The username for Elasticsearch authentication.                                                                                                  |                                     |
| `ELASTICSEARCH_PASSWORD`                   | The password for Elasticsearch authentication.                                                                                                  |                                     |
| `ELASTICSEARCH_API_KEY`                    | An API key for Elasticsearch authentication.                                                                                                    |                                     |
| `SCSI_ELASTICSEARCH_INFERENCE_ID`          | The Elasticsearch inference endpoint ID used by `semantic_text` (ELSER). Recommended: `.elser-2-elastic` (EIS).                                 | Required                            |
| `SCSI_ELASTICSEARCH_REQUEST_TIMEOUT`       | Elasticsearch request timeout in milliseconds.                                                                                                  | `90000`                             |
| `SCSI_DISABLE_SEMANTIC_TEXT`               | Set to `true` to disable the `semantic_text` mapping at index creation time (useful for tests or deployments without ML nodes).                 | `false`                             |
| `SCSI_OTEL_LOGGING_ENABLED`                | Enable OpenTelemetry logging.                                                                                                                   | `false`                             |
| `SCSI_OTEL_METRICS_ENABLED`                | Enable OpenTelemetry metrics (defaults to same as `SCSI_OTEL_LOGGING_ENABLED`).                                                                 | Same as `SCSI_OTEL_LOGGING_ENABLED` |
| `OTEL_LOG_LEVEL`                           | Minimum log level for OpenTelemetry diagnostics (`debug`, `info`, `warn`, `error`).                                                             |                                     |
| `OTEL_RESOURCE_ATTRIBUTES`                 | Resource attributes to attach to OpenTelemetry data (e.g. `deployment.environment=staging,version=1.0.0`).                                      |                                     |
| `OTEL_SERVICE_NAME`                        | Service name for OpenTelemetry logs and metrics.                                                                                                | `semantic-code-search-indexer`      |
| `OTEL_EXPORTER_OTLP_ENDPOINT`              | OpenTelemetry collector endpoint for both logs and metrics.                                                                                     | `http://localhost:4318`             |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`         | Logs-specific OTLP endpoint (overrides OTEL_EXPORTER_OTLP_ENDPOINT).                                                                            |                                     |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`      | Metrics-specific OTLP endpoint (overrides OTEL_EXPORTER_OTLP_ENDPOINT).                                                                         |                                     |
| `OTEL_EXPORTER_OTLP_HEADERS`               | Headers for OTLP exporter (e.g., `authorization=Bearer token`).                                                                                 |                                     |
| `SCSI_OTEL_METRIC_EXPORT_INTERVAL_MILLIS`  | Interval in milliseconds between metric exports.                                                                                                | `60000` (60 seconds)                |
| `SCSI_QUEUE_BASE_DIR`                      | The base directory for all repository queue databases. Each repository gets its own SQLite queue at `SCSI_QUEUE_BASE_DIR/<repo-name>/queue.db`. | `.queues`                           |
| `GITHUB_TOKEN`                             | GitHub token used for cloning/pulling private repositories.                                                                                     |                                     |
| `SCSI_LANGUAGES`                           | Optional comma-separated default list of languages to index (used when `--languages` is not provided).                                          | All supported languages             |
| `SCSI_MAX_CHUNK_SIZE_BYTES`                | The maximum size of a code chunk in bytes.                                                                                                      | `1000000`                           |
| `SCSI_DEFAULT_CHUNK_LINES`                 | Number of lines per chunk for line-based parsing (JSON, YAML, text without paragraphs).                                                         | `15`                                |
| `SCSI_CHUNK_OVERLAP_LINES`                 | Number of overlapping lines between chunks in line-based parsing.                                                                               | `3`                                 |
| `SCSI_MARKDOWN_CHUNK_DELIMITER`            | Regular expression pattern for splitting markdown files into chunks.                                                                            | `\n\s*\n`                           |
| `SCSI_ENABLE_DENSE_VECTORS`                | Whether to enable dense vectors for code similarity search.                                                                                     | `false`                             |
| `SCSI_FORCE_LOGGING`                       | Set to `true` to force console logging output even when `NODE_ENV=test`.                                                                        | `false`                             |
| `SCSI_TEST_INDEXING_THROW_ON_FILEPATH`     | (Testing only) File path to simulate an indexing failure on a specific chunk.                                                                   |                                     |
| `SCSI_TEST_INDEXING_DELAY_MS`              | (Testing only) Delay to add before indexing chunks in milliseconds.                                                                             | `0`                                 |
| `NODE_ENV`                                 | The node environment used for selecting `.env` vs `.env.test`.                                                                                  | `development`                       |

#### Elastic Inference Service (EIS) Rate Limits

`semantic_text` relies on an inference endpoint (`SCSI_ELASTICSEARCH_INFERENCE_ID`) to generate embeddings/expansions at ingest time. There are two common deployment patterns:

- **EIS (`.elser-2-elastic`)**: inference runs on the Elastic Inference Service (managed, GPU-backed). It does **not** consume your cluster’s ML node resources.
- **ML nodes (`.elser-2-elasticsearch`)**: inference runs on your Elasticsearch deployment’s ML nodes. Throughput depends on how much CPU/RAM you provision for ML.

To avoid silently changing behavior across deployments, this indexer does **not** pick a default inference endpoint. If `semantic_text` is enabled (the default), you **must** set `SCSI_ELASTICSEARCH_INFERENCE_ID`.

When using an Elastic-hosted inference endpoint, your deployment may be backed by the Elastic Inference Service (EIS), which is GPU-backed and has rate limits:

- **Rate limits**: 6,000 requests/minute OR 6,000,000 tokens/minute (whichever is reached first)
- **Important consideration**: Chunks larger than 512K may generate additional chunks in ELSER, potentially causing some batches to be rejected
- **Monitoring requirement**: Setting up an OpenTelemetry Collector is critical to monitor logs for errors when using these settings

These limits are enforced continuously. Monitor your deployment logs closely when operating near these limits.

### Chunking Strategy by File Type

The indexer uses different chunking strategies depending on file type to optimize for both semantic search quality and LLM context window limits:

- **JSON**: Always uses line-based chunking with configurable chunk size (`SCSI_DEFAULT_CHUNK_LINES`) and overlap (`SCSI_CHUNK_OVERLAP_LINES`). This prevents large JSON values from creating oversized chunks.
- **YAML**: Always uses line-based chunking with the same configuration. This provides more context than single-line chunks while maintaining manageable sizes.
- **Text files**: Uses paragraph-based chunking (splitting on double newlines) when paragraphs are detected. Falls back to line-based chunking for continuous text without paragraph breaks.
- **Markdown**: Uses configurable delimiter-based chunking to preserve logical document structure. See `SCSI_MARKDOWN_CHUNK_DELIMITER` below for customization options.
- **Code files** (TypeScript, JavaScript, Python, Java, Go, etc.): Uses tree-sitter based parsing to extract functions, classes, and other semantic units.

### Markdown Chunking

The markdown chunking behavior can be customized via the `SCSI_MARKDOWN_CHUNK_DELIMITER` environment variable:

- **`SCSI_MARKDOWN_CHUNK_DELIMITER`**: Regular expression pattern for splitting markdown files into chunks
  - **Default**: `\n\s*\n` (splits by paragraphs - double newlines)
  - **Example for section separators**: `\n---\n`
  - **Example for custom delimiter**: `\n===\n`
  - The delimiter is converted to a RegExp, so escape special characters appropriately

  **Use Cases**:
  - Default (paragraphs): Best for general markdown documents
  - Section separators (`\n---\n`): Best for markdown with explicit section dividers
  - Custom delimiters: Use any pattern that makes sense for your document structure

  **Example**:

  ```bash
  export SCSI_MARKDOWN_CHUNK_DELIMITER='\n---\n'
  npm run index
  ```

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
SCSI_OTEL_LOGGING_ENABLED=true
SCSI_OTEL_METRICS_ENABLED=true  # Optional, defaults to same as SCSI_OTEL_LOGGING_ENABLED
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

| Metric                   | Type      | Description                                       | Attributes                                                    |
| ------------------------ | --------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `parser.files.processed` | Counter   | Total files processed                             | `language`, `status`, `repo.name`, `repo.branch`              |
| `parser.files.failed`    | Counter   | Files that failed to parse                        | `language`, `status`, `repo.name`, `repo.branch`              |
| `parser.chunks.created`  | Counter   | Total chunks created                              | `language`, `parser_type`, `repo.name`, `repo.branch`         |
| `parser.chunks.skipped`  | Counter   | Chunks skipped due to exceeding maxChunkSizeBytes | `language`, `parser_type`, `size`, `repo.name`, `repo.branch` |
| `parser.chunks.size`     | Histogram | Distribution of chunk sizes (bytes)               | `language`, `parser_type`, `repo.name`, `repo.branch`         |

#### Queue Metrics

| Metric                      | Type    | Description                      | Attributes                           |
| --------------------------- | ------- | -------------------------------- | ------------------------------------ |
| `queue.documents.enqueued`  | Counter | Documents added to queue         | `repo.name`, `repo.branch`           |
| `queue.documents.dequeued`  | Counter | Documents removed from queue     | `repo.name`, `repo.branch`           |
| `queue.documents.committed` | Counter | Successfully indexed documents   | `repo.name`, `repo.branch`           |
| `queue.documents.requeued`  | Counter | Documents requeued after failure | `repo.name`, `repo.branch`           |
| `queue.documents.failed`    | Counter | Documents marked as failed       | `repo.name`, `repo.branch`           |
| `queue.documents.deleted`   | Counter | Documents deleted from queue     | `repo.name`, `repo.branch`           |
| `queue.size.pending`        | Gauge   | Current pending documents        | `repo.name`, `repo.branch`, `status` |
| `queue.size.processing`     | Gauge   | Current processing documents     | `repo.name`, `repo.branch`, `status` |
| `queue.size.failed`         | Gauge   | Current failed documents         | `repo.name`, `repo.branch`, `status` |

#### Indexer Metrics

| Metric                    | Type      | Description                 | Attributes                                |
| ------------------------- | --------- | --------------------------- | ----------------------------------------- |
| `indexer.batch.processed` | Counter   | Successful batches indexed  | `repo.name`, `repo.branch`, `concurrency` |
| `indexer.batch.failed`    | Counter   | Failed batches              | `repo.name`, `repo.branch`, `concurrency` |
| `indexer.batch.duration`  | Histogram | Batch processing time (ms)  | `repo.name`, `repo.branch`, `concurrency` |
| `indexer.batch.size`      | Histogram | Distribution of batch sizes | `repo.name`, `repo.branch`, `concurrency` |

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
SCSI_ENABLE_DENSE_VECTORS=true
```

**3. Re-index Your Data**

To generate the dense vectors for your codebase, you must run a full, clean index. This will apply the ingest pipeline to all of your documents.

```bash
npm run index -- .repos/your-repo --clean
```

---

## Testing

```bash
npm test                        # Run unit tests (fast, no dependencies)
npm run test:integration        # Run integration tests (single run with full ES setup/teardown)
```

For comprehensive testing documentation, including:

- Unit test strategies and watch modes
- Integration test workflows (single run vs. persistent ES for iteration)
- Interactive UI debugging mode (`test:ui`)
- Troubleshooting common issues
- Contributing guidelines

See the **[Developer Guide](docs/DEVELOPER_GUIDE.md)**.

---
