# Semantic Code Search Indexer

This project is a high-performance code indexer designed to provide deep, contextual code intelligence for large codebases. It combines semantic search with rich metadata extraction to power advanced AI-driven development tools.

## Features

-   **High-Throughput Indexing**: Utilizes a multi-threaded, streaming architecture to efficiently parse and index thousands of files in parallel.
-   **Semantic Search**: Uses Elasticsearch's ELSER model to generate vector embeddings for code chunks, enabling powerful natural language search.
-   **Markdown & MDX Support**: Indexes documentation (`.md`, `.mdx`) alongside code to create a unified search experience.
-   **Enriched Search Context**: The index is enriched with extensive metadata to provide deep contextual understanding for AI agents. Key fields include:
    -   `type`: Differentiates between `'code'` and `'doc'` chunks.
    -   `language`: The language of the file (`typescript`, `markdown`, etc.).
    -   `kind`: The type of the code chunk (e.g., `function_declaration`).
    -   `imports`: A list of imported modules for a given file.
    -   `containerPath`: A breadcrumb-style path of a symbol's container (e.g., `MyClass > myMethod`).
-   **Optimized Embeddings**: Injects metadata into the text before generating embeddings, significantly improving the relevance of search results for queries that blend semantic and structural intent.
-   **Efficient `.gitignore` Handling**: Correctly applies `.gitignore` rules to exclude irrelevant files and directories.

---

## Setup and Installation

### 1. Prerequisites

-   Node.js (v16 or later)
-   npm
-   An running Elasticsearch instance (v8.0 or later) with the **ELSER model downloaded and deployed**.

### 2. Clone the Repository and Install Dependencies

```bash
git clone <repository-url>
cd semantic-code-search-indexer
npm install
```

### 3. Configure Environment Variables

Copy the `.env.example` file and update it with your Elasticsearch credentials and any desired performance tunings.

```bash
cp .env.example .env
```

See the [Configuration](#configuration) section for more details.

### 4. Compile the Code

The multi-threaded worker requires the project to be compiled to JavaScript.

```bash
npm run build
```

---

## Commands

### `npm run index`

Indexes a codebase. This command scans a directory and populates the Elasticsearch index. It is recommended to run this with a high memory limit.

**Arguments:**
- `--clean`: (Optional) Deletes the existing index before starting. **Required** if the index mapping has changed.
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
| `BATCH_SIZE` | The number of chunks to index in a single bulk request. | `500` |
| `MAX_QUEUE_SIZE` | The maximum number of chunks to hold in memory before pausing file processing. | `1000` |
| `CPU_CORES` | The number of CPU cores to use for file parsing. | Half of the available cores |
