# Developer Guide

This guide covers development workflows, testing strategies, and contribution guidelines for the Semantic Code Search Indexer.

## Table of Contents

- [Development Setup](#development-setup)
- [Testing](#testing)
  - [Unit Tests](#unit-tests)
  - [Integration Tests](#integration-tests)
  - [Test Architecture](#test-architecture)
  - [Troubleshooting](#troubleshooting)
- [Code Quality](#code-quality)
- [Project Structure](#project-structure)
- [Contributing](#contributing)

---

## Development Setup

### Prerequisites

- Node.js 18+
- Docker with Compose v2 plugin
- Elasticsearch 9.x (for integration tests)
- Git

### Quick Start

```bash
# Clone the repository
git clone <repo-url>
cd semantic-code-search-indexer

# Install dependencies
npm install

# Build the project
npm run build

# Run unit tests
npm test
```

---

## Testing

We use [Vitest](https://vitest.dev/) as our testing framework, offering fast test execution, first-class TypeScript support, and an excellent developer experience.

### Unit Tests

Fast tests with no external dependencies. These test individual functions and classes in isolation using mocks.

**Commands:**

```bash
npm test              # Run all unit tests
npm run test:watch    # Watch mode for TDD
npm run test:ui       # Interactive UI mode (recommended for debugging)
npm run test:unit     # Explicitly run unit tests only
```

**Interactive UI Mode:**

The `test:ui` command opens Vitest's web-based UI in your browser, providing:
- Real-time test results with rich diffs
- Interactive filtering and search
- Code coverage visualization
- File-based test navigation
- Re-run on file changes
- Click-to-source code navigation

Perfect for debugging flaky tests or understanding test failures.

**Configuration:**
- Unit test config: `vitest.config.ts`
- Test files: `tests/unit/**/*.test.ts`
- Integration test config: `vitest.integration.config.ts`
- Integration test files: `tests/integration/**/*.test.ts`
- Setup: `tests/setup.ts` (unit) / `tests/integration-setup.ts` (integration)

**Parallelization:**
- **Local:** Tests run in parallel across all CPU cores for maximum speed
- **CI:** Tests run serially (`maxWorkers: 1`) for stability and reproducibility

### Integration Tests

Integration tests validate the full indexing pipeline against a real Elasticsearch instance with the ELSER model deployed.

#### Quick Start (Single Run - Recommended)

```bash
npm run test:integration
```

**This is a complete, isolated test run** that:
1. Sets up Elasticsearch 9.2.0 via Docker Compose (~15s)
2. Deploys the ELSER sparse embedding model
3. Runs all integration tests (~5s)
4. Tears down the infrastructure (**always**, even on failure)

**Total time: ~22 seconds per run. Clean slate every time!**

Use this for:
- Pre-commit validation
- Quick one-off tests
- When you want guaranteed clean state
- Any time you don't mind the ~15s ES startup cost

#### Development Workflow (Persistent ES - Faster Iteration)

For debugging or running tests repeatedly without ES startup overhead:

```bash
# Setup Elasticsearch once
npm run test:integration:setup

# Run integration tests (fast - no ES startup cost)
npm run test:integration:run    # 5s
npm run test:integration:run    # 5s (again)
npm run test:integration:run    # 5s (many times)

# Inspect Elasticsearch manually if needed
curl -u elastic:testpassword http://localhost:9200/_cat/indices
curl -u elastic:testpassword http://localhost:9200/test-*/_count

# Teardown when done
npm run test:integration:teardown
```

**Saves ~17s per run after initial setup!**

#### Available Commands

```bash
# Full workflow - single isolated run (most common)
npm run test:integration              # setup → run → teardown (clean slate each time)

# Manual control - keep ES running between test runs (for development)
npm run test:integration:run          # Run tests only (ES must be running)
npm run test:integration:setup        # Setup Elasticsearch environment
npm run test:integration:teardown     # Teardown Elasticsearch environment
```

#### When to Use Each Workflow

| Command | ES Lifecycle | Time per Run | Best For | Cleanup |
|---------|--------------|--------------|----------|---------|
| **`test:integration`** | Setup + Teardown every time | ~22s | Pre-commit, one-off tests, clean state | Automatic (always) |
| **`setup` → `run` (×N) → `teardown`** | Setup once, persist | ~5s each | Active dev, debugging, iteration | Manual (when done) |

#### Requirements

- **Docker Compose v2** (`docker compose` command)
  - **Local:** Docker Desktop (Mac/Windows) or Docker Engine 20.10+ with Compose plugin (Linux)
  - **CI:** GitHub Actions `ubuntu-latest` runners include Docker Compose v2
- **4GB+ RAM** available for Elasticsearch
- **Port 9200** not in use

#### What Gets Set Up

The `docker-compose.integration.yml` configuration:
- Runs Elasticsearch 9.2.0 in single-node mode
- Configures authentication (`elastic`/`testpassword`)
- Enables trial license for inference API
- Deploys ELSER model to `elser-inference-test` endpoint
- Includes health checks

#### CI/CD Integration

Integration tests run automatically in GitHub Actions with separate steps for better visibility:

```yaml
integration_tests:
  runs-on: ubuntu-latest
  steps:
    - name: Setup Elasticsearch
      run: npm run test:integration:setup
    
    - name: Run integration tests
      run: npm run test:integration:run
    
    - name: Teardown Elasticsearch
      if: always()  # Always runs, even if tests fail
      run: npm run test:integration:teardown
```

The `if: always()` ensures cleanup happens even if tests fail, preventing resource leaks in CI.

### Test Architecture

#### Test Isolation

- **Unit tests:** Use `pool: 'threads'` for better memory efficiency
- **Integration tests:** Also use threads, with configurable parallelization
- **Global teardown:** Ensures Elasticsearch client is properly closed to prevent hanging connections

#### Test Environment Variables

Integration tests use `.env.test` for configuration:

```bash
ELASTICSEARCH_ENDPOINT=http://localhost:9200
ELASTICSEARCH_USER=elastic
ELASTICSEARCH_PASSWORD=testpassword
ELASTICSEARCH_INDEX=test-code-chunks
ELASTICSEARCH_INFERENCE_ID=elser-inference-test

# Speed optimization: disable ELSER semantic_text field
# Tests the indexing pipeline without expensive ML inference
DISABLE_SEMANTIC_TEXT=true

# Timeout for bulk operations
ELASTICSEARCH_REQUEST_TIMEOUT=120000
```

**Why `DISABLE_SEMANTIC_TEXT=true`?**
- The `semantic_text` field triggers inline ELSER inference on every document
- ELSER is slow (100-500ms per document), making tests timeout
- Disabling it speeds up tests 10-100x while still validating the core indexing logic
- Full ELSER functionality is tested in manual end-to-end tests (see `docs/manual_test_plan.md`)

#### Test Fixtures

- Location: `tests/fixtures/`
- Contains sample files in multiple languages (TypeScript, Python, Go, Java, etc.)
- Integration tests create a temporary Git repo from fixtures
- Ensures consistent, reproducible test data

### Troubleshooting

#### "Elasticsearch is not available" error

Integration tests explicitly fail with setup instructions if Elasticsearch is not running.

**Solutions:**
1. **Easiest:** Use `npm run test:integration` (handles everything)
2. **Manual:** Run `npm run test:integration:setup` first
3. **Verify:** Check Docker is running:
   ```bash
   docker ps | grep elasticsearch
   ```
4. **Health check:**
   ```bash
   curl -u elastic:testpassword http://localhost:9200/_cluster/health
   ```

#### Tests hang or timeout

**Common causes:**
1. **ELSER inference slowness:** Set `DISABLE_SEMANTIC_TEXT=true` in `.env.test`
2. **Worker backpressure bug:** Fixed in this branch (see `src/utils/indexer_worker.ts`)
3. **Bulk indexing timeout:** Increase `ELASTICSEARCH_REQUEST_TIMEOUT` if needed
4. **Watch mode enabled:** Integration tests set `watch: false` explicitly

**Debug with logging:**
```bash
# Integration test setup includes logging by default
# No additional flags needed - logs show automatically
npm run test:integration:run
```

#### Memory issues / heap out of memory

**Already fixed:**
- Changed Vitest pool from `forks` to `threads` for better memory efficiency
- Added `globalTeardown` to close Elasticsearch client connections
- These fixes resolved `Worker exited unexpectedly` errors

#### Cleanup needed

```bash
# Stop all integration test containers
npm run test:integration:teardown

# Verify no containers running
docker ps -a | grep semantic

# Force cleanup if needed
docker compose -f docker-compose.integration.yml down -v
```

#### Port 9200 already in use

```bash
# Find what's using the port
lsof -i :9200

# Stop existing Elasticsearch
docker ps | grep elasticsearch | awk '{print $1}' | xargs docker stop
```

---

## Code Quality

### Linting

We use ESLint with TypeScript-specific rules:

```bash
npm run lint              # Check for issues
npm run lint -- --fix     # Auto-fix issues
```

### Formatting

Prettier is configured for consistent code style:

```bash
npm run format            # Format all files
npm run format:check      # Check formatting without changes
```

### Pre-commit Hooks

Consider setting up pre-commit hooks for automatic linting and formatting.

### Code Style Guidelines

- **TypeScript:** Strict mode enabled, avoid `any` and type assertions
- **Imports:** Use named imports, ESM syntax
- **Functions:** Keep under 50 lines, use early returns, avoid deep nesting
- **Tests:** BDD style with `describe('WHEN ...')`, `describe('AND ...')`, `it('SHOULD ...')`
- **Async:** Use `async/await` instead of `.then()` chains
- **Comments:** JSDoc for public APIs, inline comments for complex logic

---

## Project Structure

```
.
├── src/
│   ├── commands/           # CLI commands (index, setup, etc.)
│   ├── utils/              # Core utilities (ES client, logger, workers)
│   ├── languages/          # Language-specific parsers
│   └── config.ts           # Environment configuration
├── tests/
│   ├── unit/               # Unit tests (20 files, 263 tests)
│   ├── integration/        # Integration tests (1 file, 1 test)
│   ├── fixtures/           # Test data (sample code files)
│   ├── setup.ts            # Unit test setup
│   └── integration-setup.ts  # Integration test setup
├── scripts/                # Shell scripts (integration test lifecycle)
├── docs/                   # Documentation
├── vitest.config.ts        # Unit test configuration
├── vitest.integration.config.ts  # Integration test configuration
└── docker-compose.integration.yml  # ES for integration tests
```

---

## Contributing

### Workflow

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes with tests:**
   - Add unit tests for new functions/classes
   - Add integration tests for new commands or ES interactions
   - Run tests frequently: `npm run test:watch`

3. **Ensure quality:**
   ```bash
   npm run lint
   npm run format
   npm test
   npm run test:integration
   ```

4. **Commit with conventional commits:**
   ```bash
   git commit -m "feat: add new feature"
   git commit -m "fix: resolve bug in worker"
   git commit -m "test: add integration test for indexing"
   ```

5. **Push and create PR:**
   ```bash
   git push -u origin feature/your-feature-name
   # Open PR on GitHub
   ```

### Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `test:` - Add or update tests
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks
- `refactor:` - Code refactoring
- `perf:` - Performance improvements

### Pull Request Guidelines

- Provide a clear description of the change
- Link related issues
- Include screenshots/logs for UI or behavior changes
- Ensure all tests pass in CI
- Request review from maintainers

---

## Additional Resources

- [Manual Test Plan](./manual_test_plan.md) - Detailed E2E testing procedures
- [Elasticsearch Deployment Guide](./ELASTICSEARCH_DEPLOYMENT_GUIDE.md) - Production ES setup
- [GCP Deployment Guide](./GCP_DEPLOYMENT_GUIDE.md) - Cloud deployment instructions
- [Queue Recovery](./QUEUE_RECOVERY.md) - Queue management and recovery procedures
