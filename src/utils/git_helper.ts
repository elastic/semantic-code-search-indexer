import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';
import { logger } from './logger';

/**
 * Clone a repository if it doesn't exist, or pull latest changes if it does
 */
export async function cloneOrPullRepo(repoUrl: string, repoPath: string, token?: string): Promise<void> {
  const git = simpleGit();

  if (fs.existsSync(repoPath)) {
    logger.info(`Repository already exists at ${repoPath}. Pulling latest changes...`);
    try {
      // Inject token into remote URL if provided (replaces existing token if present)
      if (token) {
        const remoteUrlRaw = await git.cwd(repoPath).remote(['get-url', 'origin']);
        if (remoteUrlRaw) {
          const remoteUrl = remoteUrlRaw.trim();
          // Remove existing oauth2 auth if present, then inject new token
          const urlWithoutAuth = remoteUrl.replace(/https:\/\/oauth2:[^@]+@/, 'https://');
          const newRemoteUrl = urlWithoutAuth.replace('https://', `https://oauth2:${token}@`);
          await git.cwd(repoPath).remote(['set-url', 'origin', newRemoteUrl]);
        }
      }
      // Use fetch + reset instead of pull to handle force-pushed branches
      const currentBranch = (await git.cwd(repoPath).revparse(['--abbrev-ref', 'HEAD'])).trim();
      if (currentBranch === 'HEAD') {
        throw new Error('Cannot update repository in detached HEAD state');
      }
      await git.cwd(repoPath).fetch('origin', currentBranch);
      await git.cwd(repoPath).reset(['--hard', `origin/${currentBranch}`]);
      logger.info('Repository updated successfully.');
    } catch (error) {
      logger.error(`Error updating repository: ${error}`);
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
    logger.error(`Error cloning repository: ${error}`);
    throw error;
  }
}

/**
 * Pull latest changes in a repository
 */
export async function pullRepo(repoPath: string, branch?: string, token?: string): Promise<void> {
  logger.info(`Pulling latest changes in ${repoPath}...`);

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
    logger.error(`Error updating repository: ${error}`);
    throw error;
  }
}
