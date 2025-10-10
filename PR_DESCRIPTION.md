# Add bulk:reindex command for full repository reindexing

Adds a `bulk:reindex` command to perform full clean reindexing of multiple repositories in a single operation, eliminating the manual process of running `index --clean` and `index-worker` for each repository.

## Changes

- **New command**: `bulk:reindex` - performs clean indexing with automatic worker execution
- **Modified** `index_command.ts` - exported `index()` function with optional parameters for multi-repo support
- **Usage**: Same `path:index[:token]` format as `bulk:incremental-index`
- **Features**: Concurrency control, error handling, logging per repository

## Usage

```bash
# Single repository
npm run bulk:reindex -- .repos/kibana:kibana-index

# Multiple repositories with concurrency
npm run bulk:reindex -- .repos/kibana:kibana-index .repos/elasticsearch:es-index --concurrency 2
```

## When to use

- **`bulk:incremental-index`**: Regular updates (processes only changed files)
- **`bulk:reindex`**: Format changes, corruption recovery, initial setup (full rebuild)

Fixes #63
