# Code Intelligence Engine

This project is a high-performance code indexer and language server client designed to provide code intelligence for large codebases. It combines semantic search with compiler-accurate symbol resolution to power advanced development tools.

## Features

-   **High-Throughput Indexing**: Utilizes a multi-threaded, streaming architecture to efficiently parse and index thousands of files in parallel.
-   **Semantic Search**: Uses the `jinaai/jina-embeddings-v2-base-code` model to generate vector embeddings for code chunks, enabling powerful natural language search.
-   **Compiler-Accurate References**: Integrates directly with the TypeScript Language Server (`tsserver`) to provide 100% accurate "Find All References" functionality, just like in a modern IDE.
-   **Rich Code Parsing**: Uses Tree-sitter to extract a wide range of code constructs, including functions, classes, types, interfaces, enums, imports, and function calls.
-   **Elasticsearch Backend**: Leverages Elasticsearch for robust storage and efficient k-NN vector search.

---

## Setup and Installation

### 1. Prerequisites

-   Node.js (v16 or later)
-   npm
-   An running Elasticsearch instance (v8.0 or later)
-   [Homebrew](https://brew.sh/) (for macOS users, to install Git LFS)

### 2. Install Git LFS

This project requires Git LFS (Large File Storage) to download the code embedding model.

```bash
# Install Git LFS (macOS with Homebrew)
brew install git-lfs

# Set up Git LFS for your user account (only needs to be done once)
git lfs install
```

### 3. Clone the Repository and Install Dependencies

```bash
git clone <repository-url>
cd code-indexer
npm install
```

### 4. Download the Embedding Model

The indexer uses a local copy of the `jinaai/jina-embeddings-v2-base-code` model. You must clone it from Hugging Face into the `models` directory.

```bash
# The directory structure is important. This command creates it correctly.
git clone https://huggingface.co/jinaai/jina-embeddings-v2-base-code models/jinaai/jina-embeddings-v2-base-code
```
This will create a `models` directory in the project root. This directory is included in `.gitignore` and will not be committed to the repository.

### 5. Configure Environment Variables

Copy the example `.env` file and update it with your Elasticsearch endpoint.

```bash
cp .env.example .env
```

**`.env` file:**
```
# Elasticsearch configuration
ELASTICSEARCH_ENDPOINT=http://localhost:9200
# ELASTICSEARCH_USER=...
# ELASTICSEARCH_PASSWORD=...
# ELASTICSEARCH_API_KEY=...
```

### 6. Compile the Code

The multi-threaded worker requires the project to be compiled to JavaScript.

```bash
npm run build
```

---

## Usage

### Indexing a Codebase

Before you can search, you must index a codebase. The `index` command scans a directory and populates the Elasticsearch index.

**First-time indexing:**
It is highly recommended to run with the `--clean` flag the first time to ensure a fresh start.

```bash
# Index the Kibana monorepo located at ../../kibana
npm run index -- --clean ../../kibana
```

### Semantic Search

Use the `search` command to find code using natural language.

```bash
npm run search -- "a function that adds a new tool"
```

### Finding References

Use the `references` command to get a compiler-accurate list of all usages for a specific symbol. The position argument is `path/to/file:LINE:CHARACTER` (0-indexed).

```bash
# First, find a symbol's location with search
npm run search -- "addTool"

# Then, use the location to find all references
npm run references -- src/utils/add_tool.ts:13:10
```