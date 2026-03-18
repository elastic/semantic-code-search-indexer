import { pullRepo, cloneOrPullRepo } from '../../src/utils/git_helper';
import simpleGit from 'simple-git';
import fs from 'fs';
import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('simple-git');
vi.mock('fs');

const mockedSimpleGit = vi.mocked(simpleGit);
const mockedFs = vi.mocked(fs);

describe('git_helper', () => {
  describe('pullRepo', () => {
    let gitInstance: {
      remote: ReturnType<typeof vi.fn>;
      checkout: ReturnType<typeof vi.fn>;
      fetch: ReturnType<typeof vi.fn>;
      reset: ReturnType<typeof vi.fn>;
      revparse: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      vi.clearAllMocks();

      gitInstance = {
        remote: vi.fn().mockResolvedValue('https://github.com/org/repo.git\n'),
        checkout: vi.fn().mockResolvedValue(undefined),
        fetch: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
        revparse: vi.fn().mockResolvedValue('main\n'),
      };

      mockedSimpleGit.mockReturnValue(gitInstance as unknown as ReturnType<typeof simpleGit>);
    });

    describe('WHEN called without token or branch', () => {
      it('SHOULD fetch and reset to origin without modifying remote URL', async () => {
        await pullRepo('/path/to/repo');

        expect(gitInstance.remote).not.toHaveBeenCalled();
        expect(gitInstance.checkout).not.toHaveBeenCalled();
        expect(gitInstance.revparse).toHaveBeenCalledWith(['--abbrev-ref', 'HEAD']);
        expect(gitInstance.fetch).toHaveBeenCalledWith('origin', 'main');
        expect(gitInstance.reset).toHaveBeenCalledWith(['--hard', 'origin/main']);
      });
    });

    describe('WHEN called with branch but no token', () => {
      it('SHOULD checkout branch, fetch and reset to origin', async () => {
        await pullRepo('/path/to/repo', 'develop');

        expect(gitInstance.remote).not.toHaveBeenCalled();
        expect(gitInstance.checkout).toHaveBeenCalledWith('develop');
        expect(gitInstance.fetch).toHaveBeenCalledWith('origin', 'develop');
        expect(gitInstance.reset).toHaveBeenCalledWith(['--hard', 'origin/develop']);
      });
    });

    describe('WHEN called with token', () => {
      it('SHOULD inject token into remote URL', async () => {
        await pullRepo('/path/to/repo', undefined, 'ghp_token123');

        expect(gitInstance.remote).toHaveBeenCalledWith(['get-url', 'origin']);
        expect(gitInstance.remote).toHaveBeenCalledWith([
          'set-url',
          'origin',
          'https://oauth2:ghp_token123@github.com/org/repo.git',
        ]);
        expect(gitInstance.fetch).toHaveBeenCalledWith('origin', 'main');
        expect(gitInstance.reset).toHaveBeenCalledWith(['--hard', 'origin/main']);
      });

      it('SHOULD replace existing oauth2 token with new token', async () => {
        gitInstance.remote.mockResolvedValueOnce('https://oauth2:old_token@github.com/org/repo.git\n');

        await pullRepo('/path/to/repo', undefined, 'ghp_new_token');

        expect(gitInstance.remote).toHaveBeenCalledWith(['get-url', 'origin']);
        expect(gitInstance.remote).toHaveBeenCalledWith([
          'set-url',
          'origin',
          'https://oauth2:ghp_new_token@github.com/org/repo.git',
        ]);
        expect(gitInstance.fetch).toHaveBeenCalledWith('origin', 'main');
        expect(gitInstance.reset).toHaveBeenCalledWith(['--hard', 'origin/main']);
      });
    });

    describe('WHEN called with both token and branch', () => {
      it('SHOULD inject token, checkout branch, and fetch/reset from origin with branch', async () => {
        await pullRepo('/path/to/repo', 'main', 'ghp_token123');

        expect(gitInstance.remote).toHaveBeenCalledWith(['get-url', 'origin']);
        expect(gitInstance.remote).toHaveBeenCalledWith([
          'set-url',
          'origin',
          'https://oauth2:ghp_token123@github.com/org/repo.git',
        ]);
        expect(gitInstance.checkout).toHaveBeenCalledWith('main');
        expect(gitInstance.fetch).toHaveBeenCalledWith('origin', 'main');
        expect(gitInstance.reset).toHaveBeenCalledWith(['--hard', 'origin/main']);
      });
    });

    describe('WHEN git operation fails', () => {
      it('SHOULD throw the error', async () => {
        const fetchError = new Error('Network error');
        gitInstance.fetch.mockRejectedValue(fetchError);

        await expect(pullRepo('/path/to/repo', 'main')).rejects.toThrow('Network error');
      });
    });

    describe('WHEN remote URL is empty', () => {
      it('SHOULD not attempt to set URL', async () => {
        gitInstance.remote.mockResolvedValueOnce('');

        await pullRepo('/path/to/repo', undefined, 'ghp_token123');

        expect(gitInstance.remote).toHaveBeenCalledWith(['get-url', 'origin']);
        // Should NOT call set-url since URL is empty
        expect(gitInstance.remote).toHaveBeenCalledTimes(1);
        expect(gitInstance.fetch).toHaveBeenCalledWith('origin', 'main');
        expect(gitInstance.reset).toHaveBeenCalledWith(['--hard', 'origin/main']);
      });
    });

    describe('WHEN in detached HEAD state', () => {
      it('SHOULD throw an error', async () => {
        gitInstance.revparse.mockResolvedValue('HEAD\n');

        await expect(pullRepo('/path/to/repo')).rejects.toThrow(
          'Cannot update repository in detached HEAD state'
        );
      });
    });
  });

  describe('cloneOrPullRepo', () => {
    let gitInstance: {
      cwd: ReturnType<typeof vi.fn>;
      remote: ReturnType<typeof vi.fn>;
      fetch: ReturnType<typeof vi.fn>;
      reset: ReturnType<typeof vi.fn>;
      revparse: ReturnType<typeof vi.fn>;
      clone: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      vi.clearAllMocks();

      const self = {
        remote: vi.fn().mockResolvedValue('https://github.com/org/repo.git\n'),
        fetch: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
        revparse: vi.fn().mockResolvedValue('main\n'),
        clone: vi.fn().mockResolvedValue(undefined),
        cwd: vi.fn(),
      };
      self.cwd.mockReturnValue(self);
      gitInstance = self;

      mockedSimpleGit.mockReturnValue(gitInstance as unknown as ReturnType<typeof simpleGit>);
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.mkdirSync.mockReturnValue(undefined);
    });

    describe('WHEN repo does not exist', () => {
      it('SHOULD clone the repository', async () => {
        await cloneOrPullRepo('https://github.com/org/repo.git', '/path/to/repo');

        expect(gitInstance.clone).toHaveBeenCalledWith('https://github.com/org/repo.git', '/path/to/repo');
      });

      it('SHOULD inject token into clone URL when provided', async () => {
        await cloneOrPullRepo('https://github.com/org/repo.git', '/path/to/repo', 'ghp_token123');

        expect(gitInstance.clone).toHaveBeenCalledWith(
          'https://oauth2:ghp_token123@github.com/org/repo.git',
          '/path/to/repo'
        );
      });

      it('SHOULD create parent directory if it does not exist', async () => {
        mockedFs.existsSync.mockReturnValue(false);

        await cloneOrPullRepo('https://github.com/org/repo.git', '/path/to/repo');

        expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/path/to', { recursive: true });
      });
    });

    describe('WHEN repo already exists', () => {
      beforeEach(() => {
        mockedFs.existsSync.mockReturnValue(true);
      });

      it('SHOULD fetch and reset instead of clone', async () => {
        await cloneOrPullRepo('https://github.com/org/repo.git', '/path/to/repo');

        expect(gitInstance.clone).not.toHaveBeenCalled();
        expect(gitInstance.revparse).toHaveBeenCalledWith(['--abbrev-ref', 'HEAD']);
        expect(gitInstance.fetch).toHaveBeenCalledWith('origin', 'main');
        expect(gitInstance.reset).toHaveBeenCalledWith(['--hard', 'origin/main']);
      });

      it('SHOULD inject token into remote URL when provided', async () => {
        await cloneOrPullRepo('https://github.com/org/repo.git', '/path/to/repo', 'ghp_token123');

        expect(gitInstance.remote).toHaveBeenCalledWith(['get-url', 'origin']);
        expect(gitInstance.remote).toHaveBeenCalledWith([
          'set-url',
          'origin',
          'https://oauth2:ghp_token123@github.com/org/repo.git',
        ]);
      });

      it('SHOULD replace existing oauth2 token with new token', async () => {
        gitInstance.remote.mockResolvedValueOnce('https://oauth2:old_token@github.com/org/repo.git\n');

        await cloneOrPullRepo('https://github.com/org/repo.git', '/path/to/repo', 'ghp_new_token');

        expect(gitInstance.remote).toHaveBeenCalledWith([
          'set-url',
          'origin',
          'https://oauth2:ghp_new_token@github.com/org/repo.git',
        ]);
      });
    });

    describe('WHEN remote URL is empty during pull', () => {
      it('SHOULD not attempt to set URL', async () => {
        mockedFs.existsSync.mockReturnValue(true);
        gitInstance.remote.mockResolvedValueOnce('');

        await cloneOrPullRepo('https://github.com/org/repo.git', '/path/to/repo', 'ghp_token123');

        expect(gitInstance.remote).toHaveBeenCalledWith(['get-url', 'origin']);
        expect(gitInstance.remote).toHaveBeenCalledTimes(1);
        expect(gitInstance.fetch).toHaveBeenCalledWith('origin', 'main');
        expect(gitInstance.reset).toHaveBeenCalledWith(['--hard', 'origin/main']);
      });
    });

    describe('WHEN in detached HEAD state', () => {
      it('SHOULD throw an error', async () => {
        mockedFs.existsSync.mockReturnValue(true);
        gitInstance.revparse.mockResolvedValue('HEAD\n');

        await expect(
          cloneOrPullRepo('https://github.com/org/repo.git', '/path/to/repo')
        ).rejects.toThrow('Cannot update repository in detached HEAD state');
      });
    });

    describe('WHEN clone fails', () => {
      it('SHOULD throw the error', async () => {
        const cloneError = new Error('Auth failed');
        gitInstance.clone.mockRejectedValue(cloneError);

        await expect(cloneOrPullRepo('https://github.com/org/repo.git', '/path/to/repo')).rejects.toThrow(
          'Auth failed'
        );
      });
    });

    describe('WHEN fetch/reset fails', () => {
      it('SHOULD throw the error', async () => {
        mockedFs.existsSync.mockReturnValue(true);
        const fetchError = new Error('Network error');
        gitInstance.fetch.mockRejectedValue(fetchError);

        await expect(cloneOrPullRepo('https://github.com/org/repo.git', '/path/to/repo')).rejects.toThrow(
          'Network error'
        );
      });
    });
  });
});
