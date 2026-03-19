# Semantic Code Search Indexer — Agent Guide

## Project Overview

A high-performance CLI tool that parses codebases into semantically meaningful chunks and indexes them into Elasticsearch for AI-powered code search. It uses **tree-sitter** for AST-based parsing of 15+ languages and Elasticsearch's **ELSER** model for semantic embeddings.

**Primary use case:** Run on a schedule (cron) to keep an Elasticsearch index in sync with git repositories.

## Architecture

```
src/
├── index.ts              # CLI entrypoint (commander)
├── config.ts             # All configuration — env vars with typed getters
├── commands/             # CLI commands (index, setup, search, queue:*, etc.)
│   ├── index_command.ts  # Main `index` command — orchestrates full + incremental indexing
│   ├── full_index_producer.ts   # Enqueues all files for a full reindex
│   ├── incremental_index_command.ts  # Only processes git-changed files
│   ├── worker_command.ts # Consumer worker that processes the queue
│   ├── setup_command.ts  # Creates/updates ES index mappings
│   └── ...               # Other utility commands
├── languages/            # Language configurations (one file per language)
│   ├── index.ts          # Registry — exports all configs, validation
│   ├── typescript.ts     # Example: tree-sitter queries for TS
│   ├── templates/        # Scaffold templates for new languages
│   └── ...
└── utils/
    ├── parser.ts         # Core parsing engine — tree-sitter + custom parsers
    ├── elasticsearch.ts  # ES client, bulk indexing, document ID generation
    ├── sqlite_queue.ts   # SQLite-backed persistent work queue
    ├── indexer_worker.ts # Batch consumer with p-queue concurrency
    ├── git_helper.ts     # Git operations (clone, pull, diff, file hashes)
    ├── otel_provider.ts  # OpenTelemetry setup (logs + metrics)
    ├── metrics.ts        # OTel metrics instrumentation
    ├── logger.ts         # Structured logging
    ├── language_validator.ts  # Validates language configs at startup
    ├── constants.ts      # Shared string constants
    └── shared_extensions.ts   # Cross-language file extension resolution
```

### Key Data Flow

1. **Producer** (`full_index_producer.ts` / `incremental_index_command.ts`) walks the repo, parses files via `parser.ts`, and enqueues `CodeChunk` documents into the **SQLite queue**.
2. **Worker** (`indexer_worker.ts`) dequeues batches and bulk-indexes them into Elasticsearch via `elasticsearch.ts`.
3. The `index` command orchestrates both producer and worker together.

### Parser System

- **Tree-sitter languages** (TypeScript, JavaScript, Python, Go, Java, C, C++, Bash): AST-based parsing with S-expression queries to extract functions, classes, imports, exports, etc.
- **Custom parsers** (Markdown, YAML, JSON, text, Gradle, Handlebars, Properties): Regex/line-based splitting with language-specific chunking strategies.
- Each `LanguageConfiguration` defines: `name`, `fileSuffixes`, `parser` (tree-sitter grammar or parser type constant), `queries` (tree-sitter S-expressions), `importQueries`, `exportQueries`.
- Chunks include: content, language, file path, git metadata, line ranges, symbols, imports/exports, directory info, and a content-based `chunk_hash` for deduplication.

### Queue System

- **SQLite queue** (`sqlite_queue.ts`): Persistent, crash-safe work queue using `better-sqlite3`.
- Supports: enqueue/dequeue, retry with max 3 attempts, stale task requeue (5min timeout with PID tracking), WAL mode for concurrent reads.
- Queue state persists across restarts — incomplete indexing jobs resume automatically.

### Configuration

All config is via environment variables, loaded from `.env` (or `.env.test` in test mode). Key prefixes:
- `ELASTICSEARCH_*` — Connection settings (endpoint, cloud ID, API key, username/password)
- `SCS_IDXR_*` — Indexer-specific settings (chunk size, overlap, inference ID, OTEL, etc.)
- `OTEL_*` — OpenTelemetry standard env vars

See `src/config.ts` for the full list with defaults.

## Git Hooks (Husky)

Two hooks gate every commit and push — **you cannot bypass these without `--no-verify`**:

| Hook | Runs | Purpose |
|------|------|---------|
| **pre-commit** | `build → test → lint → format:check` | Catches errors before they enter history |
| **pre-push** | `build → test → lint → format:check` | Safety net — blocks pushes even if commit hooks were skipped |

Both hooks run the same four checks. If any step fails, the operation is aborted.

## Commands to Verify Before Committing

The hooks run these automatically, but you can run them manually:

```bash
# 1. Build (compiles TypeScript, must succeed cleanly)
npm run build

# 2. Run all unit tests
npm run test

# 3. Lint (ESLint + Prettier)
npm run lint

# 4. Check formatting (no writes, fails if unformatted)
npm run format:check
```

To auto-fix formatting issues: `npm run format`

### Additional Verification Commands

```bash
# Type-check only (no emit) — faster than full build for iterating
npm run type:check

# Format check (CI-friendly, no writes)
npm run format:check

# Run a specific test file
npx vitest run tests/unit/parser.test.ts

# Run tests in watch mode during development
npm run test:watch
```

### Integration Tests

Integration tests require a running Elasticsearch instance and are **not** part of the pre-commit hook:

```bash
# Full integration test lifecycle (setup → run → teardown)
npm run test:integration
```

Integration tests use a separate vitest config (`vitest.integration.config.ts`) with 3-minute timeouts and fork-based isolation. They live in `tests/integration/`.

## Test Conventions

- **Framework:** Vitest 4.x with globals enabled (`describe`, `it`, `expect` available without imports)
- **Unit tests:** `tests/unit/*.test.ts` — mock external dependencies (ES client, filesystem, git)
- **Integration tests:** `tests/integration/*.integration.test.ts` — require real Elasticsearch
- **Fixtures:** `tests/fixtures/` — sample source files for each supported language
- **Snapshots:** `tests/unit/__snapshots__/` — parser output snapshots (update with `npx vitest run -u`)
- **Test setup:** `tests/setup.ts` sets `NODE_ENV=test` and configures the test environment
- **Mocking:** Vitest auto-cleanup is enabled (`mockReset`, `restoreMocks`, `clearMocks`). Use `vi.mock()` for module mocks and `vi.spyOn()` for spies.
- **Config in tests:** Import from `../src/config` and set values via the config object setters (e.g., `indexingConfig.maxChunkSizeBytes = 500`). Tests use `.env.test` if it exists.
- **Pool:** Tests use `forks` pool. File parallelism is enabled locally, disabled in CI.

## Code Style & Formatting

- **Prettier** enforced via ESLint plugin. Config in `.prettierrc`:
  - Single quotes, trailing commas (es5), 2-space indent, 120 char print width, LF line endings
- **ESLint** config in `eslint.config.js` (flat config format):
  - Uses `typescript-eslint` recommended rules + prettier plugin
  - Ignores: `dist/`, `.repos/`, `tests/fixtures/`, `libs/es-query/`
- **TypeScript:** Strict mode, ES2021 target, CommonJS modules
  - `tsconfig.json` — includes tests, `noEmit: true` (for type-checking)
  - `tsconfig.build.json` — excludes tests, emits to `dist/`

## Adding a New Language

1. Run the scaffold command: `npm run -- dump-tree -- --scaffold <language-name>`
   - Or manually copy from `src/languages/templates/`
2. Create `src/languages/<name>.ts` implementing `LanguageConfiguration`
3. Register it in `src/languages/index.ts` (add import + add to `languageConfigurations` object)
4. Add a test fixture in `tests/fixtures/<name>.<ext>`
5. Add parser tests in `tests/unit/parser.test.ts` (or a new test file)
6. The language validator runs at startup and will warn about misconfigured extensions or missing queries

### Language Configuration Shape

```typescript
interface LanguageConfiguration {
  name: string;                    // Language identifier
  fileSuffixes: string[];          // File extensions (e.g., ['.ts', '.tsx'])
  parser: TreeSitterParser | string; // Tree-sitter grammar or parser type constant
  queries?: string[];              // Tree-sitter S-expression queries for code extraction
  importQueries?: string[];        // Queries for import extraction
  exportQueries?: string[];        // Queries for export extraction
  // ... additional optional fields
}
```

## Common Patterns

### Elasticsearch Client

The ES client is lazily initialized in `src/utils/elasticsearch.ts`. Commands that don't need ES (like `dump-tree`, `scaffold`) work without ES credentials. Use `getClient()` to access the singleton, `setClient()` for test injection.

### Logging

Use the structured logger from `src/utils/logger.ts`:
```typescript
import { logger, createLogger } from './logger';
logger.info('message', { key: 'value' });
const scopedLogger = createLogger('my-module');
```

Logging is suppressed in test mode (`NODE_ENV=test`) unless `SCS_IDXR_FORCE_LOGGING=true`.

### Metrics

OTel metrics are instrumented in `src/utils/metrics.ts`. Counters and histograms track: chunks indexed, files processed, parse errors, queue depth, batch durations. Metrics are cached (5s TTL) to avoid blocking the event loop.

### Error Handling

- Parser errors are logged but don't crash the indexer — individual files are skipped
- Queue failures retry up to 3 times with stale task detection (5min timeout)
- Bulk indexing errors are logged per-document; successful documents in a batch are not retried

## Important Gotchas

1. **`src/config.ts` MUST be the first import** in `src/index.ts` — it loads `.env` before anything reads `process.env`.
2. **Chunk hashing intentionally excludes file path and line numbers** — identical code in different files maps to the same document ID for deduplication/aggregation.
3. **Git env vars are stripped in `parser.ts`** (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`) to avoid issues when running inside git hooks (husky).
4. **The SQLite queue uses WAL mode** — don't delete the `-wal` or `-shm` files while the process is running.
5. **`p-queue` is pinned to v6** (CommonJS) — later versions are ESM-only and incompatible with the CommonJS build.
6. **`tree-sitter` is pinned to `^0.25.0`** via `overrides` in `package.json` — native module version must match all grammar packages.
7. **Integration tests manage their own ES indices** — they create and tear down indices; never run them against a production cluster.
8. **The `semantic_text` field type requires ELSER inference** — set `SCS_IDXR_DISABLE_SEMANTIC_TEXT=true` for local testing without an inference endpoint.
