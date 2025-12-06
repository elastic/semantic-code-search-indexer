import { Command } from 'commander';
import path from 'path';
import { appConfig } from '../config';
import { cloneOrPullRepo } from '../utils/git_helper';

async function setup(repoUrl: string, options: { token?: string }) {
  const token = options.token || appConfig.githubToken;
  const reposDir = path.join(process.cwd(), '.repos');

  const repoName = repoUrl.split('/').pop()?.replace('.git', '');
  if (!repoName) {
    throw new Error('Could not determine repository name from URL.');
  }

  const repoPath = path.join(reposDir, repoName);

  await cloneOrPullRepo(repoUrl, repoPath, token);
}

export const setupCommand = new Command('setup')
  .description('Clones a repository to be indexed')
  .argument('<repo_url>', 'The URL of the git repository to clone')
  .option('--token <token>', 'GitHub token for private repositories')
  .action(setup);

export { setup };
