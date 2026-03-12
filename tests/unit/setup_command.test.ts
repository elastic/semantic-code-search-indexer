import { setup } from '../../src/commands/setup_command';
import * as gitHelper from '../../src/utils/git_helper';
import path from 'path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { withTestEnv } from './utils/test_env';

vi.mock('../../src/utils/git_helper');

const mockedGitHelper = vi.mocked(gitHelper);

describe('setup_command', () => {
  const originalCwd = process.cwd();
  const testReposDir = path.join(originalCwd, '.repos');
  const savedGithubToken = process.env.SCSI_GITHUB_TOKEN;

  beforeEach(() => {
    // Reset process.exitCode to prevent leakage between tests
    process.exitCode = 0;
    vi.clearAllMocks();
    delete process.env.SCSI_GITHUB_TOKEN;
  });

  afterEach(() => {
    if (savedGithubToken === undefined) {
      delete process.env.SCSI_GITHUB_TOKEN;
    } else {
      process.env.SCSI_GITHUB_TOKEN = savedGithubToken;
    }
  });

  describe('WHEN setup succeeds', () => {
    it('SHOULD clone repository successfully', async () => {
      const repoUrl = 'https://github.com/elastic/kibana.git';
      mockedGitHelper.cloneOrPullRepo.mockResolvedValue(undefined);

      await setup(repoUrl);

      expect(mockedGitHelper.cloneOrPullRepo).toHaveBeenCalledWith(
        repoUrl,
        path.join(testReposDir, 'kibana'),
        undefined
      );
    });

    describe('AND github token is provided via CLI options', () => {
      it('SHOULD use provided github token', async () => {
        const repoUrl = 'https://github.com/elastic/kibana.git';
        mockedGitHelper.cloneOrPullRepo.mockResolvedValue(undefined);

        await setup(repoUrl, { githubToken: 'ghp_cli_token' });

        expect(mockedGitHelper.cloneOrPullRepo).toHaveBeenCalledWith(
          repoUrl,
          path.join(testReposDir, 'kibana'),
          'ghp_cli_token'
        );
      });
    });

    describe('AND no token is provided', () => {
      it('SHOULD use appConfig token', () =>
        withTestEnv({ SCSI_GITHUB_TOKEN: 'ghp_config_token' }, async () => {
          const repoUrl = 'https://github.com/elastic/kibana.git';
          mockedGitHelper.cloneOrPullRepo.mockResolvedValue(undefined);

          await setup(repoUrl);

          expect(mockedGitHelper.cloneOrPullRepo).toHaveBeenCalledWith(
            repoUrl,
            path.join(testReposDir, 'kibana'),
            'ghp_config_token'
          );
        }));
    });
  });

  describe('WHEN setup fails', () => {
    it('SHOULD re-throw error', async () => {
      const repoUrl = 'https://github.com/elastic/kibana.git';
      const error = new Error('Clone failed: authentication error');
      mockedGitHelper.cloneOrPullRepo.mockRejectedValue(error);

      await expect(setup(repoUrl)).rejects.toThrow('Clone failed: authentication error');
    });

    describe('AND error is a network timeout', () => {
      it('SHOULD throw error', async () => {
        const repoUrl = 'https://github.com/elastic/kibana.git';
        const error = new Error('Network timeout');
        mockedGitHelper.cloneOrPullRepo.mockRejectedValue(error);

        await expect(setup(repoUrl)).rejects.toThrow('Network timeout');
      });
    });
  });

  describe('WHEN repository URL is invalid', () => {
    describe('AND URL has no repository name', () => {
      it('SHOULD throw error', async () => {
        const invalidUrl = 'https://github.com/';
        mockedGitHelper.cloneOrPullRepo.mockResolvedValue(undefined);

        await expect(setup(invalidUrl)).rejects.toThrow('Could not determine repository name from URL.');

        expect(mockedGitHelper.cloneOrPullRepo).not.toHaveBeenCalled();
      });
    });

    describe('AND URL is empty', () => {
      it('SHOULD throw error', async () => {
        mockedGitHelper.cloneOrPullRepo.mockResolvedValue(undefined);

        await expect(setup('')).rejects.toThrow('Could not determine repository name from URL.');

        expect(mockedGitHelper.cloneOrPullRepo).not.toHaveBeenCalled();
      });
    });
  });

  describe('WHEN repository URL has .git extension', () => {
    it('SHOULD correctly extract repo name', async () => {
      const repoUrl = 'https://github.com/elastic/kibana.git';
      mockedGitHelper.cloneOrPullRepo.mockResolvedValue(undefined);

      await setup(repoUrl);

      expect(mockedGitHelper.cloneOrPullRepo).toHaveBeenCalledWith(
        repoUrl,
        path.join(testReposDir, 'kibana'),
        undefined
      );
    });
  });

  describe('WHEN repository URL does not have .git extension', () => {
    it('SHOULD correctly extract repo name', async () => {
      const repoUrl = 'https://github.com/elastic/kibana';
      mockedGitHelper.cloneOrPullRepo.mockResolvedValue(undefined);

      await setup(repoUrl);

      expect(mockedGitHelper.cloneOrPullRepo).toHaveBeenCalledWith(
        repoUrl,
        path.join(testReposDir, 'kibana'),
        undefined
      );
    });
  });
});
