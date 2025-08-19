# Semantic Code Search Indexer

This project is a high-performance code indexer and language server client designed to provide code intelligence for large codebases. It combines semantic search with compiler-accurate symbol resolution to power advanced development tools.

## Features

-   **High-Throughput Indexing**: Utilizes a multi-threaded, streaming architecture to efficiently parse and index thousands of files in parallel.
-   **Semantic Search**: Uses Elasticsearch's ELSERv2 model to generate vector embeddings for code chunks, enabling powerful natural language search.
-   **Compiler-Accurate References**: Integrates directly with the TypeScript Language Server (`tsserver`) to provide 100% accurate "Find All References" functionality, just like in a modern IDE.
-   **Rich Code Parsing**: Uses Tree-sitter to extract a wide range of code constructs, including functions, classes, types, interfaces, enums, imports, and function calls.
-   **Elasticsearch Backend**: Leverages Elasticsearch for robust storage and efficient k-NN vector search.

---

## Setup and Installation

### 1. Prerequisites

-   Node.js (v16 or later)
-   npm
-   An running Elasticsearch instance (v8.0 or later)

### 2. Clone the Repository and Install Dependencies

```bash
git clone <repository-url>
cd semantic-code-search-indexer
npm install
```

### 3. Configure Environment Variables

Copy the example `.env` file and update it with your Elasticsearch endpoint.

```bash
cp .env.example .env
```

See the [Configuration](#configuration) section for more details on the available environment variables.

### 4. Compile the Code

The multi-threaded worker requires the project to be compiled to JavaScript.

```bash
npm run build
```

---

## Commands

### `npm run index`

Indexes a codebase. This command scans a directory and populates the Elasticsearch index.

**Arguments:**
- `--clean`: (Optional) Deletes the existing index before starting. Recommended for first-time indexing.
- `<directory>`: The path to the codebase to index.

**Example:**
```bash
# Index the Kibana monorepo located at ../../kibana
npm run index -- --clean ../../kibana
```

### `npm run incremental-index`

After an initial full index, you can use this command to efficiently update the index with only the files that have changed since the last indexed commit.

**Arguments:**
- `<directory>`: The path to the codebase to index.

**Example:**
```bash
npm run incremental-index -- ../../kibana
```

### `npm run search`

Finds code using natural language.

**Arguments:**
- `<query>`: The natural language query to search for.

**Example:**
```bash
npm run search -- "a function that adds a new tool"
```

### `npm run references`

Gets a compiler-accurate list of all usages for a specific symbol.

**Arguments:**
- `<position>`: The position of the symbol in the format `path/to/file:LINE:CHARACTER` (0-indexed).

**Example:**
```bash
npm run references -- src/utils/add_tool.ts:13:10
```

### `npm run build`

Compiles the TypeScript code to JavaScript. This is required for the multi-threaded worker to function.

### `npm run lint`

Lints the codebase using ESLint.

---

## Configuration

Configuration is managed via environment variables. You can set them in a `.env` file in the project root.

| Variable | Description | Default |
| --- | --- | --- |
| `ELASTICSEARCH_ENDPOINT` | The URL of your Elasticsearch instance. | `http://localhost:9200` |
| `ELASTICSEARCH_USER` | The username for Elasticsearch authentication. | |
| `ELASTICSEARCH_PASSWORD` | The password for Elasticsearch authentication. | |
| `ELASTICSEARCH_API_KEY` | An API key for Elasticsearch authentication. | |
| `ELASTICSEARCH_MODEL` | The ID of the ELSER model to use. | `.elser_model_2` |
| `ELASTICSEARCH_INDEX` | The name of the Elasticsearch index to use. | `code-chunks` |