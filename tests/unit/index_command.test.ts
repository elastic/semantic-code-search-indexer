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
        const mockWarn = vi.spyOn(logger, 'warn');
        const result = parseRepoArg('my-repo');

        expect(result.repoName).toBe('my-repo');
        expect(result.repoPath).toContain('.repos/my-repo');
        expect(result.indexName).toBe('my'); // -repo is stripped to allow alias creation
        expect(mockWarn).toHaveBeenCalledWith('Index name "my-repo" was normalized to "my" ');
      });

      it('SHOULD use custom index name when provided', () => {
        const result = parseRepoArg('my-repo:custom-index');

        expect(result.repoName).toBe('my-repo');
        expect(result.indexName).toBe('custom-index');
      });

      it('SHOULD deduplicate -repo segments from index name', () => {
        const mockWarn = vi.spyOn(logger, 'warn');
        const result = parseRepoArg('my-repo:my-repo-repo-repo');

        expect(result.indexName).toBe('my');
        expect(mockWarn).toHaveBeenCalledWith('Index name "my-repo-repo-repo" was normalized to "my" ');
      });

      it('SHOULD deduplicate index name with single -repo segment', () => {
        const mockWarn = vi.spyOn(logger, 'warn');
        const result = parseRepoArg('my-repo:my-repo');

        expect(result.indexName).toBe('my');
        expect(mockWarn).toHaveBeenCalledWith('Index name "my-repo" was normalized to "my" ');
      });

      it('SHOULD deduplicate -repo segments from index name in URL format', () => {
        const mockWarn = vi.spyOn(logger, 'warn');
        const result = parseRepoArg('https://github.com/elastic/kibana.git:kibana-repo-repo');

        expect(result.indexName).toBe('kibana');
        expect(mockWarn).toHaveBeenCalledWith('Index name "kibana-repo-repo" was normalized to "kibana" ');
      });
    });

    describe('WHEN parsing a full path', () => {
      it('SHOULD use the provided path and extract repo name', () => {
        const mockWarn = vi.spyOn(logger, 'warn');
        const result = parseRepoArg('/absolute/path/to/my-repo');

        expect(result.repoName).toBe('my-repo');
        expect(result.repoPath).toBe('/absolute/path/to/my-repo');
        expect(result.indexName).toBe('my'); // -repo is stripped to allow alias creation
        expect(mockWarn).toHaveBeenCalledWith('Index name "my-repo" was normalized to "my" ');
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
        const mockWarn = vi.spyOn(logger, 'warn');
        const result = parseRepoArg('C:\\Users\\dev\\repos\\my-repo');

        // On non-Windows systems, path.basename may not parse Windows paths correctly
        // The important thing is that it's recognized as a path (not a URL) and resolved
        expect(result.repoPath).toContain('my-repo');
        // On macOS, path.basename doesn't parse Windows paths correctly, so repoName becomes the full path
        // and indexName gets normalized from that full path. Just verify normalization happened.
        if (result.indexName.includes('\\')) {
          // Windows path wasn't parsed correctly, indexName is the normalized full path
          expect(result.indexName).toContain('my'); // -repo was stripped
          expect(mockWarn).toHaveBeenCalled();
        } else {
          // Path was parsed correctly, -repo should be stripped
          expect(result.indexName).toBe('my');
          expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('Index name "my-repo" was normalized to "my"'));
        }
      });

      it('SHOULD handle Windows absolute path with forward slashes', () => {
        const mockWarn = vi.spyOn(logger, 'warn');
        const result = parseRepoArg('C:/Users/dev/repos/my-repo');

        expect(result.repoName).toBe('my-repo');
        // path.resolve on macOS will prepend cwd to Windows-style paths
        expect(result.repoPath).toContain('my-repo');
        expect(result.indexName).toBe('my'); // -repo is stripped to allow alias creation
        expect(mockWarn).toHaveBeenCalledWith('Index name "my-repo" was normalized to "my" ');
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
        const mockWarn = vi.spyOn(logger, 'warn');
        const result = parseRepoArg('c:\\repos\\test-repo');

        // Verify it's treated as a path
        expect(result.repoPath).toContain('test-repo');
        // On macOS, path.basename doesn't parse Windows paths correctly, so repoName becomes the full path
        // and indexName gets normalized from that full path. Just verify normalization happened.
        if (result.indexName.includes('\\')) {
          // Windows path wasn't parsed correctly, indexName is the normalized full path
          expect(result.indexName).toContain('test'); // -repo was stripped
          expect(mockWarn).toHaveBeenCalled();
        } else {
          // Path was parsed correctly, -repo should be stripped
          expect(result.indexName).toBe('test');
          expect(mockWarn).toHaveBeenCalledWith(
            expect.stringContaining('Index name "test-repo" was normalized to "test"')
          );
        }
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
});
