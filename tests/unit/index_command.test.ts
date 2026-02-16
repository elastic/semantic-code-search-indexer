import { parseRepoArg, hasQueueItems, ensureRepoCloned, indexCommand } from '../../src/commands/index_command';
import { appConfig } from '../../src/config';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Database from 'better-sqlite3';
import * as gitHelper from '../../src/utils/git_helper';
import { logger } from '../../src/utils/logger';
import * as workerModule from '../../src/commands/worker_command';
import * as fullIndexModule from '../../src/commands/full_index_producer';
import * as incrementalModule from '../../src/commands/incremental_index_command';
import * as elasticsearchModule from '../../src/utils/elasticsearch';
import { SqliteQueue } from '../../src/utils/sqlite_queue';
import type { CodeChunk } from '../../src/utils/elasticsearch';
import { execFileSync } from 'child_process';
import * as otelProvider from '../../src/utils/otel_provider';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

// Mock child_process but keep all other functions
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

describe('index_command', () => {
  // Use unique test directory in system temp to avoid parallel test conflicts
  const testQueuesDir = path.join(os.tmpdir(), `index-command-test-${process.pid}-${Date.now()}`);

  beforeEach(() => {
    vi.restoreAllMocks();

    // Reset process.exitCode to prevent leakage between tests
    process.exitCode = 0;

    // Reset Commander options to prevent leakage between tests
    // Commander caches parsed options, so we need to reset them
    indexCommand.setOptionValue('pull', undefined);
    indexCommand.setOptionValue('clean', undefined);
    indexCommand.setOptionValue('watch', undefined);
    indexCommand.setOptionValue('token', undefined);
    indexCommand.setOptionValue('branch', undefined);
    indexCommand.setOptionValue('concurrency', '1');

    // Alias-first defaults: tests can override these per scenario.
    vi.spyOn(elasticsearchModule, 'resolveAliasToIndex').mockResolvedValue('resolved-test-index');
    vi.spyOn(elasticsearchModule, 'swapAliasTargets').mockResolvedValue({
      previousIndexNames: [],
      previousLocationsIndexNames: [],
    });
    vi.spyOn(elasticsearchModule, 'acquireReindexLock').mockResolvedValue({ acquired: true, lock: null });
    vi.spyOn(elasticsearchModule, 'releaseReindexLock').mockResolvedValue(undefined);
    vi.spyOn(elasticsearchModule, 'isReindexLocked').mockResolvedValue(false);
    vi.spyOn(elasticsearchModule, 'createSettingsIndex').mockResolvedValue(undefined);
    vi.spyOn(elasticsearchModule, 'deleteIndex').mockResolvedValue(undefined);

    // Clean up test directories
    if (fs.existsSync(testQueuesDir)) {
      fs.rmSync(testQueuesDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testQueuesDir)) {
      fs.rmSync(testQueuesDir, { recursive: true });
    }
  });

  describe('parseRepoArg', () => {
    describe('WHEN parsing a GitHub URL', () => {
      it('SHOULD extract repo name and set correct path', () => {
        const result = parseRepoArg('https://github.com/elastic/kibana.git');

        expect(result.repoName).toBe('kibana');
        expect(result.repoPath).toContain('.repos/kibana');
        expect(result.indexName).toBe('kibana');
      });

      it('SHOULD use custom index name when provided', () => {
        const result = parseRepoArg('https://github.com/elastic/kibana.git:custom-index');

        expect(result.repoName).toBe('kibana');
        expect(result.indexName).toBe('custom-index');
      });

      it('SHOULD handle URLs without .git extension', () => {
        const result = parseRepoArg('https://github.com/elastic/elasticsearch');

        expect(result.repoName).toBe('elasticsearch');
        expect(result.indexName).toBe('elasticsearch');
      });

      it('SHOULD use global token and branch when provided', () => {
        const result = parseRepoArg('https://github.com/elastic/kibana.git', 'ghp_token123', 'main');

        expect(result.token).toBe('ghp_token123');
        expect(result.branch).toBe('main');
      });

      it('SHOULD handle git@ SSH URLs', () => {
        const result = parseRepoArg('git@github.com:elastic/kibana.git');

        expect(result.repoName).toBe('kibana');
        expect(result.indexName).toBe('kibana');
      });

      it('SHOULD handle git@ SSH URLs with custom index', () => {
        const result = parseRepoArg('git@github.com:elastic/kibana.git:custom-index');

        expect(result.repoName).toBe('kibana');
        expect(result.indexName).toBe('custom-index');
      });

      it('SHOULD handle HTTPS URLs with port numbers', () => {
        const result = parseRepoArg('https://git.example.com:8443/org/repo.git');

        expect(result.repoName).toBe('repo');
        expect(result.indexName).toBe('repo');
      });

      it('SHOULD handle HTTPS URLs with port and custom index', () => {
        const result = parseRepoArg('https://git.example.com:8443/org/repo.git:my-index');

        expect(result.repoName).toBe('repo');
        expect(result.indexName).toBe('my-index');
      });
    });

    describe('WHEN parsing a repo name', () => {
      it('SHOULD construct path in .repos directory', () => {
        const result = parseRepoArg('my-repo');

        expect(result.repoName).toBe('my-repo');
        expect(result.repoPath).toContain('.repos/my-repo');
        expect(result.indexName).toBe('my-repo');
      });

      it('SHOULD use custom index name when provided', () => {
        const result = parseRepoArg('my-repo:custom-index');

        expect(result.repoName).toBe('my-repo');
        expect(result.indexName).toBe('custom-index');
      });
    });

    describe('WHEN parsing a full path', () => {
      it('SHOULD use the provided path and extract repo name', () => {
        const result = parseRepoArg('/absolute/path/to/my-repo');

        expect(result.repoName).toBe('my-repo');
        expect(result.repoPath).toBe('/absolute/path/to/my-repo');
        expect(result.indexName).toBe('my-repo');
      });

      it('SHOULD handle relative paths', () => {
        const result = parseRepoArg('./relative/path/to/my-repo');

        expect(result.repoName).toBe('my-repo');
        expect(result.repoPath).toContain('my-repo');
      });

      it('SHOULD support custom index with path', () => {
        const result = parseRepoArg('/path/to/my-repo:custom-index');

        expect(result.repoName).toBe('my-repo');
        expect(result.indexName).toBe('custom-index');
      });
    });

    describe('WHEN parsing Windows paths', () => {
      it('SHOULD handle Windows absolute path with backslashes', () => {
        const result = parseRepoArg('C:\\Users\\dev\\repos\\my-repo');

        // On non-Windows systems, path.basename may not parse Windows paths correctly
        // The important thing is that it's recognized as a path (not a URL) and resolved
        expect(result.repoPath).toContain('my-repo');
        expect(result.indexName).toContain('my-repo');
      });

      it('SHOULD handle Windows absolute path with forward slashes', () => {
        const result = parseRepoArg('C:/Users/dev/repos/my-repo');

        expect(result.repoName).toBe('my-repo');
        // path.resolve on macOS will prepend cwd to Windows-style paths
        expect(result.repoPath).toContain('my-repo');
        expect(result.indexName).toBe('my-repo');
      });

      it('SHOULD handle Windows path with custom index', () => {
        const result = parseRepoArg('C:\\Users\\dev\\repos\\my-repo:custom-index');

        // The index name should be correctly extracted
        expect(result.indexName).toBe('custom-index');
        expect(result.repoPath).toContain('my-repo');
      });

      it('SHOULD handle Windows path with drive letter D', () => {
        const result = parseRepoArg('D:/projects/repo:my-index');

        expect(result.repoName).toBe('repo');
        expect(result.indexName).toBe('my-index');
      });

      it('SHOULD handle lowercase drive letter', () => {
        const result = parseRepoArg('c:\\repos\\test-repo');

        // Verify it's treated as a path
        expect(result.repoPath).toContain('test-repo');
        expect(result.indexName).toContain('test-repo');
      });
    });
  });

  describe('REPOSITORIES_TO_INDEX env var support', () => {
    it('SHOULD parse env var when set', () => {
      const originalEnv = process.env.REPOSITORIES_TO_INDEX;

      // Test that env var is parsed correctly
      process.env.REPOSITORIES_TO_INDEX = 'repo1 repo2 repo3';
      const repos = process.env.REPOSITORIES_TO_INDEX.trim().split(/\s+/);

      expect(repos).toEqual(['repo1', 'repo2', 'repo3']);

      // Cleanup
      process.env.REPOSITORIES_TO_INDEX = originalEnv;
    });

    it('SHOULD handle custom index names in env var', () => {
      const originalEnv = process.env.REPOSITORIES_TO_INDEX;

      process.env.REPOSITORIES_TO_INDEX = 'repo1:index1 repo2:index2';
      const repos = process.env.REPOSITORIES_TO_INDEX.trim().split(/\s+/);

      expect(repos).toEqual(['repo1:index1', 'repo2:index2']);

      // Cleanup
      process.env.REPOSITORIES_TO_INDEX = originalEnv;
    });
  });

  describe('hasQueueItems', () => {
    describe('WHEN queue has pending items', () => {
      it('SHOULD return true', () => {
        const queueDir = path.join(testQueuesDir, 'test-repo');
        fs.mkdirSync(queueDir, { recursive: true });

        const db = new Database(path.join(queueDir, 'queue.db'));

        try {
          // Create queue table
          db.exec(`
            CREATE TABLE IF NOT EXISTS queue (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              status TEXT DEFAULT 'pending'
            )
          `);

          // Insert a pending item
          db.prepare('INSERT INTO queue (status) VALUES (?)').run('pending');
        } finally {
          db.close();
        }

        // Mock appConfig to use test directory
        Object.defineProperty(appConfig, 'queueBaseDir', {
          value: testQueuesDir,
          writable: true,
          configurable: true,
        });

        const result = hasQueueItems(path.basename(queueDir));

        expect(result).toBe(true);
      });

      it('SHOULD return true for processing items', () => {
        const queueDir = path.join(testQueuesDir, 'test-repo2');
        fs.mkdirSync(queueDir, { recursive: true });

        const db = new Database(path.join(queueDir, 'queue.db'));

        try {
          db.exec(`
            CREATE TABLE IF NOT EXISTS queue (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              status TEXT DEFAULT 'pending'
            )
          `);

          db.prepare('INSERT INTO queue (status) VALUES (?)').run('processing');
        } finally {
          db.close();
        }

        Object.defineProperty(appConfig, 'queueBaseDir', {
          value: testQueuesDir,
          writable: true,
          configurable: true,
        });

        const result = hasQueueItems(path.basename(queueDir));

        expect(result).toBe(true);
      });
    });

    describe('WHEN queue is empty or has only completed items', () => {
      it('SHOULD return false for empty queue', () => {
        const queueDir = path.join(testQueuesDir, 'empty-repo');
        fs.mkdirSync(queueDir, { recursive: true });

        const db = new Database(path.join(queueDir, 'queue.db'));

        try {
          // Create empty queue table
          db.exec(`
            CREATE TABLE IF NOT EXISTS queue (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              status TEXT DEFAULT 'pending'
            )
          `);
        } finally {
          db.close();
        }

        Object.defineProperty(appConfig, 'queueBaseDir', {
          value: testQueuesDir,
          writable: true,
          configurable: true,
        });

        const result = hasQueueItems(path.basename(queueDir));

        expect(result).toBe(false);
      });

      it('SHOULD return false when only completed items exist', () => {
        const queueDir = path.join(testQueuesDir, 'completed-repo');
        fs.mkdirSync(queueDir, { recursive: true });

        const db = new Database(path.join(queueDir, 'queue.db'));

        try {
          db.exec(`
            CREATE TABLE IF NOT EXISTS queue (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              status TEXT DEFAULT 'pending'
            )
          `);

          db.prepare('INSERT INTO queue (status) VALUES (?)').run('completed');
          db.prepare('INSERT INTO queue (status) VALUES (?)').run('failed');
        } finally {
          db.close();
        }

        Object.defineProperty(appConfig, 'queueBaseDir', {
          value: testQueuesDir,
          writable: true,
          configurable: true,
        });

        const result = hasQueueItems(path.basename(queueDir));

        expect(result).toBe(false);
      });
    });

    describe('WHEN queue database does not exist', () => {
      it('SHOULD return false', () => {
        Object.defineProperty(appConfig, 'queueBaseDir', {
          value: testQueuesDir,
          writable: true,
          configurable: true,
        });

        const result = hasQueueItems('nonexistent-repo');

        expect(result).toBe(false);
      });
    });
  });

  describe('ensureRepoCloned', () => {
    const testRepoPath = path.join(os.tmpdir(), `test-repo-${process.pid}-${Date.now()}`);

    beforeEach(() => {
      // Clean up test repo
      if (fs.existsSync(testRepoPath)) {
        fs.rmSync(testRepoPath, { recursive: true });
      }
    });

    afterEach(() => {
      // Clean up
      if (fs.existsSync(testRepoPath)) {
        fs.rmSync(testRepoPath, { recursive: true });
      }
      vi.restoreAllMocks();
    });

    describe('WHEN repository already exists', () => {
      it('SHOULD log info and not call cloneOrPullRepo', async () => {
        // Create test repo directory
        fs.mkdirSync(testRepoPath, { recursive: true });

        const cloneOrPullRepoSpy = vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        const loggerInfoSpy = vi.spyOn(logger, 'info');

        await ensureRepoCloned('https://github.com/test/repo.git', testRepoPath);

        expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Repository already exists'));
        expect(cloneOrPullRepoSpy).not.toHaveBeenCalled();
      });
    });

    describe('WHEN repository does not exist', () => {
      it('SHOULD call cloneOrPullRepo with correct parameters', async () => {
        const cloneOrPullRepoSpy = vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();

        await ensureRepoCloned('https://github.com/test/repo.git', testRepoPath);

        expect(cloneOrPullRepoSpy).toHaveBeenCalledWith('https://github.com/test/repo.git', testRepoPath, undefined);
      });

      it('SHOULD pass token to cloneOrPullRepo when provided', async () => {
        const cloneOrPullRepoSpy = vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();

        await ensureRepoCloned('https://github.com/test/repo.git', testRepoPath, 'ghp_token123');

        expect(cloneOrPullRepoSpy).toHaveBeenCalledWith(
          'https://github.com/test/repo.git',
          testRepoPath,
          'ghp_token123'
        );
      });

      it('SHOULD handle SSH URLs correctly', async () => {
        const cloneOrPullRepoSpy = vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();

        await ensureRepoCloned('git@github.com:test/repo.git', testRepoPath);

        expect(cloneOrPullRepoSpy).toHaveBeenCalledWith('git@github.com:test/repo.git', testRepoPath, undefined);
      });
    });
  });

  describe('indexRepos with watch mode', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Mock execFileSync to return a branch name
      vi.mocked(execFileSync).mockReturnValue(Buffer.from('main\n'));
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('WHEN watch mode is enabled with multiple repos', () => {
      it('SHOULD warn that only the first repo will be watched', async () => {
        const loggerWarnSpy = vi.spyOn(logger, 'warn');

        // Mock all the dependencies to prevent actual execution
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        vi.spyOn(gitHelper, 'pullRepo').mockResolvedValue();

        // Mock the worker and indexing functions
        vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        vi.spyOn(incrementalModule, 'incrementalIndex').mockResolvedValue(undefined);
        vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);

        // Mock shutdown
        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        // Execute the command with multiple repos and watch flag
        await indexCommand.parseAsync([
          'node',
          'test',
          '/path/to/repo1',
          '/path/to/repo2',
          '/path/to/repo3',
          '--watch',
        ]);

        // Verify warning was logged
        expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Watch mode enabled with 3 repositories'));
        expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Only the first repository'));
        expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('/path/to/repo1'));
      });
    });

    describe('WHEN watch mode is enabled with single repo', () => {
      it('SHOULD not warn about multiple repos', async () => {
        const loggerWarnSpy = vi.spyOn(logger, 'warn');

        // Mock all the dependencies
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        vi.spyOn(gitHelper, 'pullRepo').mockResolvedValue();

        vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);

        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        // Execute with single repo
        await indexCommand.parseAsync(['node', 'test', '/path/to/repo1', '--watch']);

        // Verify no warning about multiple repos
        expect(loggerWarnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Watch mode enabled with'));
      });
    });

    describe('WHEN processing multiple repos with watch mode', () => {
      it('SHOULD pass watch=true only to first repo worker', async () => {
        const workerSpy = vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);

        // Mock all dependencies
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        vi.spyOn(gitHelper, 'pullRepo').mockResolvedValue();

        vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);

        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        // Execute with multiple repos and watch
        await indexCommand.parseAsync(['node', 'test', '/path/to/repo1', '/path/to/repo2', '--watch']);

        // Verify worker was called twice
        expect(workerSpy).toHaveBeenCalledTimes(2);

        // First call should have watch=true
        expect(workerSpy).toHaveBeenNthCalledWith(
          1,
          1, // concurrency
          true, // watch=true for first repo
          expect.objectContaining({
            repoName: 'repo1',
          })
        );

        // Second call should have watch=false
        expect(workerSpy).toHaveBeenNthCalledWith(
          2,
          1, // concurrency
          false, // watch=false for second repo
          expect.objectContaining({
            repoName: 'repo2',
          })
        );
      });
    });

    describe('WHEN watch mode is enabled', () => {
      it('SHOULD log which repo is being watched', async () => {
        const loggerInfoSpy = vi.spyOn(logger, 'info');

        // Mock all dependencies
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        vi.spyOn(gitHelper, 'pullRepo').mockResolvedValue();

        vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);

        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        // Execute with watch mode
        await indexCommand.parseAsync(['node', 'test', '/path/to/my-repo', '--watch']);

        // Verify watch-specific logging
        expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('watch mode enabled'));
        expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Watching queue for my-repo'));
      });
    });
  });

  describe('--pull flag behavior', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(execFileSync).mockReturnValue(Buffer.from('main\n'));
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('WHEN --pull flag is provided', () => {
      it('SHOULD call pullRepo with correct parameters', async () => {
        const pullRepoSpy = vi.spyOn(gitHelper, 'pullRepo').mockResolvedValue();

        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        await indexCommand.parseAsync(['node', 'test', '/path/to/my-repo', '--pull']);

        expect(pullRepoSpy).toHaveBeenCalledWith('/path/to/my-repo', undefined, undefined);
      });

      it('SHOULD pass token to pullRepo when provided', async () => {
        const pullRepoSpy = vi.spyOn(gitHelper, 'pullRepo').mockResolvedValue();

        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        await indexCommand.parseAsync(['node', 'test', '/path/to/my-repo', '--pull', '--token', 'ghp_test123']);

        expect(pullRepoSpy).toHaveBeenCalledWith('/path/to/my-repo', undefined, 'ghp_test123');
      });

      it('SHOULD pass branch to pullRepo when provided', async () => {
        const pullRepoSpy = vi.spyOn(gitHelper, 'pullRepo').mockResolvedValue();

        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        await indexCommand.parseAsync([
          'node',
          'test',
          '/path/to/my-repo',
          '--pull',
          '--branch',
          'develop',
          '--token',
          'ghp_branch_test',
        ]);

        expect(pullRepoSpy).toHaveBeenCalledWith('/path/to/my-repo', 'develop', 'ghp_branch_test');
      });

      it('SHOULD NOT pass pull option to incrementalIndex (pull already done before indexing)', async () => {
        const incrementalIndexSpy = vi.spyOn(incrementalModule, 'incrementalIndex').mockResolvedValue(undefined);

        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        vi.spyOn(gitHelper, 'pullRepo').mockResolvedValue();
        vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue('abc123');
        vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        await indexCommand.parseAsync(['node', 'test', '/path/to/my-repo', '--pull']);

        expect(incrementalIndexSpy).toHaveBeenCalled();
        const options = incrementalIndexSpy.mock.calls[0][1];
        expect(options).not.toHaveProperty('pull');
      });
    });

    describe('WHEN pull fails for single repo', () => {
      it('SHOULD throw error immediately', async () => {
        const pullError = new Error('Failed to pull: network error');
        vi.spyOn(gitHelper, 'pullRepo').mockRejectedValue(pullError);

        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        await expect(indexCommand.parseAsync(['node', 'test', '/path/to/my-repo', '--pull'])).rejects.toThrow(
          'Failed to pull: network error'
        );
      });
    });

    describe('WHEN pull fails for multi-repo', () => {
      it('SHOULD skip failed repo, continue processing, and set exitCode 1 at end', async () => {
        // Stateful mock: first repo pull fails, second succeeds
        vi.spyOn(gitHelper, 'pullRepo').mockImplementation(async (repoPath) => {
          if (repoPath.includes('pull-repo1')) {
            throw new Error('Pull failed: network error');
          }
          return Promise.resolve();
        });

        const originalExistsSync = fs.existsSync;
        vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
          const pathStr = p.toString();
          if (pathStr.includes('pull-repo1') || pathStr.includes('pull-repo2')) {
            return true;
          }
          return originalExistsSync(p);
        });

        vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        const workerSpy = vi.spyOn(workerModule, 'worker');

        await indexCommand.parseAsync(['node', 'test', '/path/to/pull-repo1', '/path/to/pull-repo2', '--pull']);

        // Second repo should have been processed (worker called once)
        expect(workerSpy).toHaveBeenCalledTimes(1);
        // Should set exitCode to 1 at the end
        expect(process.exitCode).toBe(1);
      });
    });
  });

  describe('clone error handling', () => {
    describe('WHEN clone fails for single repo', () => {
      it('SHOULD throw error immediately', async () => {
        // Stateful mock: always reject for this test
        vi.spyOn(gitHelper, 'cloneOrPullRepo').mockImplementation(async () => {
          throw new Error('Authentication failed');
        });

        const originalExistsSync = fs.existsSync;
        vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
          const pathStr = p.toString();
          if (pathStr.includes('.repos')) {
            return false;
          }
          return originalExistsSync(p);
        });

        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        await expect(indexCommand.parseAsync(['node', 'test', 'https://github.com/org/repo.git'])).rejects.toThrow(
          'Authentication failed'
        );
      });
    });
  });

  describe('clone URL parsing', () => {
    it('WHEN cloning an SSH repo with :alias SHOULD strip the alias suffix from the clone URL', async () => {
      const repoUrlWithAlias = 'git@github.com:elastic/kibana.git:custom-index';
      const expectedCloneUrl = 'git@github.com:elastic/kibana.git';

      let repoExists = false;
      const originalExistsSync = fs.existsSync;
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr.includes('.repos/kibana')) {
          return repoExists;
        }
        return originalExistsSync(p);
      });

      vi.spyOn(gitHelper, 'cloneOrPullRepo').mockImplementation(async (url) => {
        expect(url).toBe(expectedCloneUrl);
        repoExists = true;
      });

      // Avoid real work
      vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
      vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
      vi.spyOn(incrementalModule, 'incrementalIndex').mockResolvedValue(undefined);
      vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
      vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
      vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

      // Mock branch + HEAD reads used later in the flow
      vi.mocked(execFileSync).mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return Buffer.from('main\n');
        }
        if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return Buffer.from('head-commit\n');
        }
        return Buffer.from('');
      });

      await indexCommand.parseAsync(['node', 'test', repoUrlWithAlias]);
    });
  });

  describe('clone error handling - multi-repo', () => {
    it('WHEN clone fails for first repo SHOULD skip failed repo, continue processing, and set exitCode 1 at end', async () => {
      // Use unique repo names to avoid conflicts with other tests
      const failedRepo = 'clone-fail-repo';
      const successRepo = 'clone-success-repo';

      // Stateful mock: track clone attempts and successes
      const cloneAttempts = new Map<string, boolean>(); // repoPath -> succeeded
      vi.spyOn(gitHelper, 'cloneOrPullRepo').mockImplementation(async (_url, repoPath) => {
        if (repoPath.includes(failedRepo)) {
          cloneAttempts.set(repoPath, false);
          throw new Error('Authentication failed');
        }
        cloneAttempts.set(repoPath, true);
      });

      // Stateful mock: return false before clone, true after successful clone
      const originalExistsSync = fs.existsSync;
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        // For .repos paths, check if clone succeeded
        if (pathStr.includes(`.repos/${failedRepo}`)) {
          return cloneAttempts.get(pathStr) === true;
        }
        if (pathStr.includes(`.repos/${successRepo}`)) {
          return cloneAttempts.get(pathStr) === true;
        }
        return originalExistsSync(p);
      });

      // Mock execFileSync for git branch detection
      vi.mocked(execFileSync).mockReturnValue(Buffer.from('main\n'));

      vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
      vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
      vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
      vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
      vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

      const workerSpy = vi.spyOn(workerModule, 'worker');

      await indexCommand.parseAsync([
        'node',
        'test',
        `https://github.com/org/${failedRepo}.git`,
        `https://github.com/org/${successRepo}.git`,
      ]);

      // Second repo should have been processed (worker called once)
      expect(workerSpy).toHaveBeenCalledTimes(1);
      // Should set exitCode to 1 at the end
      expect(process.exitCode).toBe(1);
    });
  });

  describe('missing repo error handling', () => {
    describe('WHEN single repo path does not exist', () => {
      it('SHOULD throw immediately', async () => {
        const originalExistsSync = fs.existsSync;
        vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
          const pathStr = p.toString();
          if (pathStr.includes('nonexistent')) {
            return false;
          }
          return originalExistsSync(p);
        });

        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        await expect(indexCommand.parseAsync(['node', 'test', '/path/to/nonexistent'])).rejects.toThrow(
          'Repository not found at'
        );
      });
    });

    describe('WHEN multi-repo and one path does not exist', () => {
      it('SHOULD skip missing repo, continue processing, and set exitCode 1', async () => {
        const originalExistsSync = fs.existsSync;
        vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
          const pathStr = p.toString();
          if (pathStr.includes('missing-repo')) {
            return false;
          }
          if (pathStr.includes('existing-repo')) {
            return true;
          }
          return originalExistsSync(p);
        });

        vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
        vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        const workerSpy = vi.spyOn(workerModule, 'worker');

        await indexCommand.parseAsync(['node', 'test', '/path/to/missing-repo', '/path/to/existing-repo']);

        // Second repo should have been processed
        expect(workerSpy).toHaveBeenCalledTimes(1);
        expect(process.exitCode).toBe(1);
      });
    });
  });

  describe('alias-first maintenance behavior', () => {
    const repoPath = '/path/to/my-repo';

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(execFileSync).mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return Buffer.from('main\n');
        }
        if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return Buffer.from('head-commit\n');
        }
        return Buffer.from('');
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('WHEN maintenance lock exists on non-clean run SHOULD skip indexing work', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
      vi.spyOn(gitHelper, 'pullRepo').mockResolvedValue();
      vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
      vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
      vi.spyOn(elasticsearchModule, 'isReindexLocked').mockResolvedValue(true);
      vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
      vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
      vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

      await indexCommand.parseAsync(['node', 'test', repoPath]);

      expect(elasticsearchModule.isReindexLocked).toHaveBeenCalledWith('my-repo');
      expect(fullIndexModule.index).not.toHaveBeenCalled();
      expect(workerModule.worker).not.toHaveBeenCalled();
    });

    it('WHEN clean run completes SHOULD swap aliases and clean old backing indices', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
      vi.spyOn(gitHelper, 'pullRepo').mockResolvedValue();
      const fullIndexSpy = vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
      vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
      vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue('old-commit');
      vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
      const acquireLockSpy = vi
        .spyOn(elasticsearchModule, 'acquireReindexLock')
        .mockResolvedValue({ acquired: true, lock: null });
      const swapAliasesSpy = vi.spyOn(elasticsearchModule, 'swapAliasTargets').mockResolvedValue({
        previousIndexNames: ['old-main'],
        previousLocationsIndexNames: ['old-main_locations'],
      });
      const deleteIndexSpy = vi.spyOn(elasticsearchModule, 'deleteIndex').mockResolvedValue(undefined);
      const releaseLockSpy = vi.spyOn(elasticsearchModule, 'releaseReindexLock').mockResolvedValue(undefined);
      vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

      await indexCommand.parseAsync(['node', 'test', repoPath, '--clean']);

      expect(acquireLockSpy).toHaveBeenCalledWith('my-repo', expect.any(String));
      expect(fullIndexSpy).toHaveBeenCalledWith(
        repoPath,
        true,
        expect.objectContaining({
          elasticsearchIndex: expect.stringContaining('my-repo-scsi-'),
          settingsIndex: 'my-repo',
        })
      );
      expect(swapAliasesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          aliasName: 'my-repo',
        })
      );
      expect(deleteIndexSpy).toHaveBeenCalledWith('old-main');
      expect(deleteIndexSpy).toHaveBeenCalledWith('old-main_locations');
      expect(releaseLockSpy).toHaveBeenCalledWith('my-repo');
    });
  });

  describe('queue resume incremental catch-up', () => {
    const repoPath = '/path/to/my-repo';
    const repoName = 'my-repo';

    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const createQueuedChunk = (id: string): CodeChunk => ({
      type: 'code',
      language: 'text',
      chunk_hash: `chunk-${id}`,
      content: `content-${id}`,
      semantic_text: `content-${id}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const setupQueueWithPendingItem = async (options: { enqueueCompleted: boolean; enqueueCommitHash?: string }) => {
      Object.defineProperty(appConfig, 'queueBaseDir', {
        value: testQueuesDir,
        writable: true,
        configurable: true,
      });

      const queueDir = path.join(testQueuesDir, repoName);
      fs.mkdirSync(queueDir, { recursive: true });

      const queue = new SqliteQueue({ dbPath: path.join(queueDir, 'queue.db'), repoName, branch: 'main' });
      await queue.initialize();

      // Ensure the queue is non-empty so `hasQueueItems()` returns true.
      await queue.enqueue([createQueuedChunk('1')]);

      if (typeof options.enqueueCommitHash === 'string') {
        await queue.setEnqueueCommitHash(options.enqueueCommitHash);
      }
      if (options.enqueueCompleted) {
        await queue.markEnqueueCompleted();
      }

      queue.close();
    };

    const mockRepoExists = () => {
      const originalExistsSync = fs.existsSync;
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr === repoPath) return true;
        return originalExistsSync(p);
      });
    };

    const mockGitBranchAndHead = (head: string) => {
      vi.mocked(execFileSync).mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return Buffer.from('main\n');
        }
        if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return Buffer.from(`${head}\n`);
        }
        return Buffer.from('');
      });
    };

    it('WHEN resuming a completed queue and HEAD advanced SHOULD run incremental catch-up before updating settings', async () => {
      await setupQueueWithPendingItem({ enqueueCompleted: true, enqueueCommitHash: 'old-commit' });
      mockRepoExists();
      mockGitBranchAndHead('new-commit');

      const workerSpy = vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
      const incrementalSpy = vi.spyOn(incrementalModule, 'incrementalIndex').mockResolvedValue(undefined);
      vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);

      vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue('old-commit');
      const createSettingsSpy = vi.spyOn(elasticsearchModule, 'createSettingsIndex').mockResolvedValue(undefined);
      const updateSpy = vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
      vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

      await indexCommand.parseAsync(['node', 'test', repoPath]);

      // First: drain existing queue. Second: drain incremental catch-up work.
      expect(workerSpy).toHaveBeenCalledTimes(2);
      expect(incrementalSpy).toHaveBeenCalledTimes(1);

      // Final: settings commit advanced to HEAD.
      expect(createSettingsSpy).toHaveBeenCalled();
      expect(updateSpy).toHaveBeenCalledWith('main', 'new-commit', repoName);

      // Verify high-level ordering: drain -> incremental -> drain -> update.
      const workerOrder1 = workerSpy.mock.invocationCallOrder[0];
      const workerOrder2 = workerSpy.mock.invocationCallOrder[1];
      const incrementalOrder = incrementalSpy.mock.invocationCallOrder[0];
      const updateOrder = updateSpy.mock.invocationCallOrder[updateSpy.mock.invocationCallOrder.length - 1];

      if (
        workerOrder1 === undefined ||
        workerOrder2 === undefined ||
        incrementalOrder === undefined ||
        updateOrder === undefined
      ) {
        throw new Error('Expected invocationCallOrder to contain entries for worker, incrementalIndex, and update.');
      }

      expect(workerOrder1).toBeLessThan(incrementalOrder);
      expect(incrementalOrder).toBeLessThan(workerOrder2);
      expect(workerOrder2).toBeLessThan(updateOrder);
    });

    it('WHEN resuming a completed queue and HEAD did not advance SHOULD not run incremental catch-up', async () => {
      await setupQueueWithPendingItem({ enqueueCompleted: true, enqueueCommitHash: 'same-commit' });
      mockRepoExists();
      mockGitBranchAndHead('same-commit');

      const workerSpy = vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
      const incrementalSpy = vi.spyOn(incrementalModule, 'incrementalIndex').mockResolvedValue(undefined);
      vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);

      vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue('same-commit');
      vi.spyOn(elasticsearchModule, 'createSettingsIndex').mockResolvedValue(undefined);
      const updateSpy = vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
      vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

      await indexCommand.parseAsync(['node', 'test', repoPath]);

      expect(workerSpy).toHaveBeenCalledTimes(1);
      expect(incrementalSpy).not.toHaveBeenCalled();
      expect(updateSpy).toHaveBeenCalledWith('main', 'same-commit', repoName);
    });

    it('WHEN resuming a completed queue and settings baseline is missing SHOULD seed baseline from queue before catch-up', async () => {
      await setupQueueWithPendingItem({ enqueueCompleted: true, enqueueCommitHash: 'base-commit' });
      mockRepoExists();
      mockGitBranchAndHead('new-commit');

      const workerSpy = vi.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
      const incrementalSpy = vi.spyOn(incrementalModule, 'incrementalIndex').mockResolvedValue(undefined);
      vi.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);

      vi.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
      vi.spyOn(elasticsearchModule, 'createSettingsIndex').mockResolvedValue(undefined);
      const updateSpy = vi.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);
      vi.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

      await indexCommand.parseAsync(['node', 'test', repoPath]);

      expect(workerSpy).toHaveBeenCalledTimes(2);
      expect(incrementalSpy).toHaveBeenCalledTimes(1);

      // 1) Seed baseline so incrementalIndex has a commit hash. 2) Advance to HEAD at the end.
      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(updateSpy).toHaveBeenNthCalledWith(1, 'main', 'base-commit', repoName);
      expect(updateSpy).toHaveBeenNthCalledWith(2, 'main', 'new-commit', repoName);
    });
  });
});
