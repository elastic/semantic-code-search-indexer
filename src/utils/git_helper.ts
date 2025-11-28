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
      await git.cwd(repoPath).pull();
      logger.info('Repository updated successfully.');
    } catch (error) {
      logger.error(`Error pulling repository: ${error}`);
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
      await git.pull('origin', branch);
    } else {
      await git.pull('origin');
    }
    logger.info('Repository updated successfully.');
  } catch (error) {
    logger.error(`Error pulling repository: ${error}`);
    throw error;
  }
}
