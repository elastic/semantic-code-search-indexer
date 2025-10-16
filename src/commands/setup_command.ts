import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import simpleGit from 'simple-git';
import { appConfig } from '../config';
import { logger } from '../utils/logger';

async function setup(repoUrl: string, options: { token?: string }) {
  const token = options.token || appConfig.githubToken;
  const reposDir = path.join(process.cwd(), '.repos');

  if (!fs.existsSync(reposDir)) {
    fs.mkdirSync(reposDir);
  }

  const repoName = repoUrl.split('/').pop()?.replace('.git', '');
  if (!repoName) {
    logger.error('Could not determine repository name from URL.');
    return;
  }

  const repoPath = path.join(reposDir, repoName);
  const git = simpleGit();

  if (fs.existsSync(repoPath)) {
    logger.info(`Repository ${repoName} already exists. Pulling latest changes...`);
    try {
      const remoteUrlRaw = await git.cwd(repoPath).remote(['get-url', 'origin']);
      if (token && remoteUrlRaw) {
        const remoteUrl = remoteUrlRaw.trim();
        const hasBasicAuth = remoteUrl.includes('oauth2:');

        // Extract existing token from remote URL if present
        let existingToken: string | null = null;
        if (hasBasicAuth) {
          const tokenMatch = remoteUrl.match(/oauth2:([^@]+)@/);
          existingToken = tokenMatch ? tokenMatch[1] : null;
        }

        // Only update remote URL if token is different
        if (!hasBasicAuth || existingToken !== token) {
          let newRemoteUrl: string;
          if (hasBasicAuth) {
            newRemoteUrl = remoteUrl.replace(/oauth2:[^@]+@/, `oauth2:${token}@`);
          } else {
            newRemoteUrl = remoteUrl.replace('https://', `https://oauth2:${token}@`);
          }
          await git.cwd(repoPath).remote(['set-url', 'origin', newRemoteUrl]);
          logger.info('Updated remote URL with fresh GitHub token.');
        } else {
          logger.info('GitHub token is already up to date.');
        }
      }
      await git.cwd(repoPath).pull();
      logger.info('Repository updated successfully.');
    } catch (error) {
      logger.error(`Error pulling repository: ${error}`);
    }
    return;
  }

  logger.info(`Cloning ${repoUrl} into ${repoPath}...`);
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
  }
}

export const setupCommand = new Command('setup')
  .description('Clones a repository to be indexed')
  .argument('<repo_url>', 'The URL of the git repository to clone')
  .option('--token <token>', 'GitHub token for private repositories')
  .action(setup);
