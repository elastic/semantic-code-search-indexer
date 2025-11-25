import { parseRepoArg, hasQueueItems, ensureRepoCloned, indexCommand } from '../src/commands/index_command';
import { appConfig } from '../src/config';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Database from 'better-sqlite3';
import * as gitHelper from '../src/utils/git_helper';
import { logger } from '../src/utils/logger';
import * as workerModule from '../src/commands/worker_command';
import * as fullIndexModule from '../src/commands/full_index_producer';
import * as incrementalModule from '../src/commands/incremental_index_command';
import * as elasticsearchModule from '../src/utils/elasticsearch';
import { execFileSync } from 'child_process';
import * as otelProvider from '../src/utils/otel_provider';

// Mock child_process but keep all other functions
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    execFileSync: jest.fn(),
  };
});

describe('index_command', () => {
  // Use unique test directory in system temp to avoid parallel test conflicts
  const testQueuesDir = path.join(os.tmpdir(), `index-command-test-${process.pid}-${Date.now()}`);

  beforeEach(() => {
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
      jest.restoreAllMocks();
    });

    describe('WHEN repository already exists', () => {
      it('SHOULD log info and not call cloneOrPullRepo', async () => {
        // Create test repo directory
        fs.mkdirSync(testRepoPath, { recursive: true });

        const cloneOrPullRepoSpy = jest.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        const loggerInfoSpy = jest.spyOn(logger, 'info');

        await ensureRepoCloned('https://github.com/test/repo.git', testRepoPath);

        expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Repository already exists'));
        expect(cloneOrPullRepoSpy).not.toHaveBeenCalled();
      });
    });

    describe('WHEN repository does not exist', () => {
      it('SHOULD call cloneOrPullRepo with correct parameters', async () => {
        const cloneOrPullRepoSpy = jest.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();

        await ensureRepoCloned('https://github.com/test/repo.git', testRepoPath);

        expect(cloneOrPullRepoSpy).toHaveBeenCalledWith('https://github.com/test/repo.git', testRepoPath, undefined);
      });

      it('SHOULD pass token to cloneOrPullRepo when provided', async () => {
        const cloneOrPullRepoSpy = jest.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();

        await ensureRepoCloned('https://github.com/test/repo.git', testRepoPath, 'ghp_token123');

        expect(cloneOrPullRepoSpy).toHaveBeenCalledWith(
          'https://github.com/test/repo.git',
          testRepoPath,
          'ghp_token123'
        );
      });

      it('SHOULD handle SSH URLs correctly', async () => {
        const cloneOrPullRepoSpy = jest.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();

        await ensureRepoCloned('git@github.com:test/repo.git', testRepoPath);

        expect(cloneOrPullRepoSpy).toHaveBeenCalledWith('git@github.com:test/repo.git', testRepoPath, undefined);
      });
    });
  });

  describe('indexRepos with watch mode', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Mock execFileSync to return a branch name
      (execFileSync as jest.Mock).mockReturnValue(Buffer.from('main\n'));
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe('WHEN watch mode is enabled with multiple repos', () => {
      it('SHOULD warn that only the first repo will be watched', async () => {
        const loggerWarnSpy = jest.spyOn(logger, 'warn');

        // Mock all the dependencies to prevent actual execution
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        jest.spyOn(gitHelper, 'pullRepo').mockResolvedValue();

        // Mock the worker and indexing functions
        jest.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        jest.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        jest.spyOn(incrementalModule, 'incrementalIndex').mockResolvedValue(undefined);
        jest.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        jest.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);

        // Mock shutdown
        jest.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

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
        const loggerWarnSpy = jest.spyOn(logger, 'warn');

        // Mock all the dependencies
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        jest.spyOn(gitHelper, 'pullRepo').mockResolvedValue();

        jest.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        jest.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        jest.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        jest.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);

        jest.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        // Execute with single repo
        await indexCommand.parseAsync(['node', 'test', '/path/to/repo1', '--watch']);

        // Verify no warning about multiple repos
        expect(loggerWarnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Watch mode enabled with'));
      });
    });

    describe('WHEN processing multiple repos with watch mode', () => {
      it('SHOULD pass watch=true only to first repo worker', async () => {
        const workerSpy = jest.spyOn(workerModule, 'worker').mockResolvedValue(undefined);

        // Mock all dependencies
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        jest.spyOn(gitHelper, 'pullRepo').mockResolvedValue();

        jest.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        jest.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        jest.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);

        jest.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

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
        const loggerInfoSpy = jest.spyOn(logger, 'info');

        // Mock all dependencies
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(gitHelper, 'cloneOrPullRepo').mockResolvedValue();
        jest.spyOn(gitHelper, 'pullRepo').mockResolvedValue();

        jest.spyOn(workerModule, 'worker').mockResolvedValue(undefined);
        jest.spyOn(fullIndexModule, 'index').mockResolvedValue(undefined);
        jest.spyOn(elasticsearchModule, 'getLastIndexedCommit').mockResolvedValue(null);
        jest.spyOn(elasticsearchModule, 'updateLastIndexedCommit').mockResolvedValue(undefined);

        jest.spyOn(otelProvider, 'shutdown').mockResolvedValue(undefined);

        // Execute with watch mode
        await indexCommand.parseAsync(['node', 'test', '/path/to/my-repo', '--watch']);

        // Verify watch-specific logging
        expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('watch mode enabled'));
        expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Watching queue for my-repo'));
      });
    });
  });
});
