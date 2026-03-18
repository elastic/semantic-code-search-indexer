import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';
import { logger } from './logger';

const redactOauthToken = (value: string): string => value.replace(/oauth2:[^@]+@/g, 'oauth2:***@');

/**
 * Clone a repository if it doesn't exist, or fetch and hard-reset if it does.
 * Uses fetch + reset --hard to handle upstream force-pushes gracefully.
 */
export async function cloneOrPullRepo(repoUrl: string, repoPath: string, token?: string): Promise<void> {
  const git = simpleGit();

  if (fs.existsSync(repoPath)) {
    logger.info(`Repository already exists at ${repoPath}. Fetching latest changes...`);
    const repoGit = git.cwd(repoPath);
    try {
      // Inject token into remote URL if provided (replaces existing token if present)
      if (token) {
        const remoteUrlRaw = await repoGit.remote(['get-url', 'origin']);
        if (remoteUrlRaw) {
          const remoteUrl = remoteUrlRaw.trim();
          // Remove existing oauth2 auth if present, then inject new token
          const urlWithoutAuth = remoteUrl.replace(/https:\/\/oauth2:[^@]+@/, 'https://');
          const newRemoteUrl = urlWithoutAuth.replace('https://', `https://oauth2:${token}@`);
          await repoGit.remote(['set-url', 'origin', newRemoteUrl]);
        }
      }
      // Use fetch + reset instead of pull to handle force-pushed branches
      const currentBranch = (await repoGit.revparse(['--abbrev-ref', 'HEAD'])).trim();
      if (currentBranch === 'HEAD') {
        throw new Error('Cannot update repository in detached HEAD state');
      }
      await repoGit.fetch('origin', currentBranch);
      await repoGit.reset(['--hard', `origin/${currentBranch}`]);
      logger.info('Repository updated successfully.');
    } catch (error) {
      const errorMessage = error instanceof Error ? redactOauthToken(error.message) : redactOauthToken(String(error));
      logger.error('Failed to update repository', { repoPath, errorMessage });
      throw error;
    }
    return;
  }

  logger.info(`Cloning ${repoUrl} to ${repoPath}...`);

  const reposDir = path.dirname(repoPath);
  if (!fs.existsSync(reposDir)) {
    fs.mkdirSync(reposDir, { recursive: true });
  }

  try {
    if (token) {
      const remoteUrl = repoUrl.replace('https://', `https://oauth2:${token}@`);
      await git.clone(remoteUrl, repoPath);
    } else {
      await git.clone(repoUrl, repoPath);
    }
    logger.info('Repository cloned successfully.');
  } catch (error) {
    const errorMessage = error instanceof Error ? redactOauthToken(error.message) : redactOauthToken(String(error));
    logger.error('Failed to clone repository', { repoPath, errorMessage });
    throw error;
  }
}

/**
 * Fetch and hard-reset a repository to match the remote branch.
 * Uses fetch + reset --hard to handle upstream force-pushes gracefully.
 */
export async function pullRepo(repoPath: string, branch?: string, token?: string): Promise<void> {
  logger.info(`Fetching latest changes in ${repoPath}...`);

  const git = simpleGit(repoPath);

  try {
    // Inject token into remote URL if provided (replaces existing token if present)
    if (token) {
      const remoteUrlRaw = await git.remote(['get-url', 'origin']);
      if (remoteUrlRaw) {
        const remoteUrl = remoteUrlRaw.trim();
        // Remove existing oauth2 auth if present, then inject new token
        const urlWithoutAuth = remoteUrl.replace(/https:\/\/oauth2:[^@]+@/, 'https://');
        const newRemoteUrl = urlWithoutAuth.replace('https://', `https://oauth2:${token}@`);
        await git.remote(['set-url', 'origin', newRemoteUrl]);
      }
    }

    if (branch) {
      await git.checkout(branch);
      await git.fetch('origin', branch);
      await git.reset(['--hard', `origin/${branch}`]);
    } else {
      const currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      if (currentBranch === 'HEAD') {
        throw new Error('Cannot update repository in detached HEAD state');
      }
      await git.fetch('origin', currentBranch);
      await git.reset(['--hard', `origin/${currentBranch}`]);
    }
    logger.info('Repository updated successfully.');
  } catch (error) {
    const errorMessage = error instanceof Error ? redactOauthToken(error.message) : redactOauthToken(String(error));
    logger.error('Failed to update repository', { repoPath, branch, errorMessage });
    throw error;
  }
}
