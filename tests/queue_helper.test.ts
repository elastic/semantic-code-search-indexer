import { resolveRepoName, getQueueDir, getQueueDbPath } from '../src/utils/queue_helper';
import { appConfig } from '../src/config';
import fs from 'fs';
import path from 'path';

describe('queue_helper', () => {
  const testQueueBaseDir = path.join(__dirname, '.test-queues');

  beforeEach(() => {
    // Mock appConfig.queueBaseDir
    Object.defineProperty(appConfig, 'queueBaseDir', {
      value: testQueueBaseDir,
      writable: true,
      configurable: true,
    });

    // Clean up test directory
    if (fs.existsSync(testQueueBaseDir)) {
      fs.rmSync(testQueueBaseDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testQueueBaseDir)) {
      fs.rmSync(testQueueBaseDir, { recursive: true });
    }
  });

  describe('WHEN resolving repo name', () => {
    it('SHOULD return the provided repo name if specified', () => {
      const result = resolveRepoName('my-repo');
      expect(result).toBe('my-repo');
    });

    it('SHOULD auto-detect repo name if only one exists', () => {
      const repoDir = path.join(testQueueBaseDir, 'test-repo');
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(repoDir, 'queue.db'), '');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = resolveRepoName();

      expect(result).toBe('test-repo');
      expect(consoleSpy).toHaveBeenCalledWith('Auto-detected repository: test-repo');

      consoleSpy.mockRestore();
    });

    it('SHOULD exit with error if multiple repos exist and none specified', () => {
      const repo1Dir = path.join(testQueueBaseDir, 'repo1');
      const repo2Dir = path.join(testQueueBaseDir, 'repo2');
      fs.mkdirSync(repo1Dir, { recursive: true });
      fs.mkdirSync(repo2Dir, { recursive: true });
      fs.writeFileSync(path.join(repo1Dir, 'queue.db'), '');
      fs.writeFileSync(path.join(repo2Dir, 'queue.db'), '');

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      resolveRepoName();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Multiple repositories found: repo1, repo2');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Please specify which repository with --repo-name');
      expect(exitSpy).toHaveBeenCalledWith(1);

      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('SHOULD exit with error if no repos exist', () => {
      fs.mkdirSync(testQueueBaseDir, { recursive: true });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      resolveRepoName();

      expect(consoleErrorSpy).toHaveBeenCalledWith('No repositories found in .queues/');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Have you run "npm run index <repo>" yet?');
      expect(exitSpy).toHaveBeenCalledWith(1);

      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('SHOULD exit with error if .queues directory does not exist', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit(${code})`);
      });

      expect(() => resolveRepoName()).toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith('.queues/ directory not found');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Have you run "npm run index <repo>" yet?');
      expect(exitSpy).toHaveBeenCalledWith(1);

      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe('WHEN getting queue directory', () => {
    it('SHOULD return correct queue directory path', () => {
      const result = getQueueDir('my-repo');
      expect(result).toBe(path.join(testQueueBaseDir, 'my-repo'));
    });
  });

  describe('WHEN getting queue database path', () => {
    it('SHOULD return correct queue database path', () => {
      const result = getQueueDbPath('my-repo');
      expect(result).toBe(path.join(testQueueBaseDir, 'my-repo', 'queue.db'));
    });
  });
});
