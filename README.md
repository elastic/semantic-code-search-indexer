# Semantic Code Search Indexer

This project is a high-performance code indexer designed to provide deep, contextual code intelligence for large codebases. It combines semantic search with rich metadata extraction to power advanced AI-driven development tools. The primary use case is to run on a schedule (e.g., a cron job) to keep an Elasticsearch index up-to-date with a git repository.

## Features

-   **High-Throughput Indexing**: Utilizes a multi-threaded, streaming architecture to efficiently parse and index thousands of files in parallel.
-   **Semantic Search**: Uses Elasticsearch's ELSER model to generate vector embeddings for code chunks, enabling powerful natural language search.
-   **Incremental Updates**: Can efficiently update the index by only processing files that have changed since the last indexed commit.
-   **Structured Logging**: Outputs logs in JSON format, making it easy to monitor and integrate with log management systems.
-   **Efficient `.gitignore` Handling**: Correctly applies `.gitignore` rules to exclude irrelevant files and directories.
-   **MCP Server**: Includes a Model Context Protocol (MCP) server that exposes the indexed data through a standardized set of tools.

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

### `npm run search`

Finds code using natural language.

**Arguments:**
- `<query>`: The natural language query to search for.

**Example:**
```bash
npm run search -- "a function that adds a new tool"
```

---

## MCP Server

This project includes a Model Context Protocol (MCP) server that exposes the indexed data through a standardized set of tools. This allows AI coding agents to interact with the indexed codebase in a structured way.

### Running the Server

The MCP server can be run in two modes:

**1. Stdio Mode:**
This is the default mode. The server communicates over `stdin` and `stdout`.

```bash
npm run mcp-server
```

**2. HTTP Mode:**
This mode is useful for running the server in a containerized environment like Docker.

```bash
npm run mcp-server:http
```

The server will listen on port 3000 by default. You can change the port by setting the `PORT` environment variable.

### Usage with NPX

You can also run the MCP server directly from the git repository using `npx`. This is a convenient way to run the server without having to clone the repository.

**Stdio Mode:**
```bash
ELASTICSEARCH_ENDPOINT=http://localhost:9200 npx github:elastic/semantic-code-search-indexer
```

**HTTP Mode:**
```bash
PORT=8080 ELASTICSEARCH_ENDPOINT=http://localhost:9200 npx github:elastic/semantic-code-search-indexer http
```

### Available Prompts

| Prompt | Description |
| --- | --- |
| `StartInvestigation` | A prompt that guides the user through a "chain of investigation" to understand a codebase and accomplish a task. |

**Example:**
```
/StartInvestigation --task="add a new route to the kibana server"
```

### Available Tools

The MCP server provides the following tools:

| Tool | Description |
| --- | --- |
| `semantic_code_search` | Performs a semantic search on the code chunks in the index. This tool can combine a semantic query with a KQL filter to provide flexible and powerful search capabilities. |
| `list_symbols_by_query` | Lists symbols that match a given KQL query. This is useful for finding all the symbols in a specific file or directory. |
| `symbol_analysis` | Analyzes a symbol and returns a report of its definitions, call sites, and references. This is useful for understanding the role of a symbol in the codebase. |
| `read_file_from_chunks` | Reads the content of a file from the index, providing a reconstructed view based on the most important indexed chunks. |
| `document_symbols` | Analyzes a file to identify the key symbols that would most benefit from documentation. This is useful for automating the process of improving the semantic quality of a codebase. |

---

## Deployment

This indexer is designed to be deployed on a server (e.g., a GCP Compute Engine VM) and run on a schedule. For detailed instructions on how to set up the indexer with `systemd` timers or `cron`, please see the [GCP Deployment Guide](./docs/gcp_deployment_guide.md).

---

## Configuration

Configuration is managed via environment variables in a `.env` file.

| Variable | Description | Default |
| --- | --- | --- |
| `ELASTICSEARCH_CLOUD_ID` | The Cloud ID for your Elastic Cloud instance. | |
| `ELASTICSEARCH_API_KEY` | An API key for Elasticsearch authentication. | |
| `ELASTICSEARCH_INDEX` | The name of the Elasticsearch index to use. | `code-chunks` |
| `BATCH_SIZE` | The number of chunks to index in a single bulk request. | `500` |
| `CPU_CORES` | The number of CPU cores to use for file parsing. | Half of the available cores |
| `LOG_FORMAT` | The format of the logs. Can be `json` or `text`. | `json` |
| `SEMANTIC_CODE_INDEXER_LANGUAGES` | A comma-separated list of languages to index. | `typescript,javascript,markdown,yaml,java,go,python` |