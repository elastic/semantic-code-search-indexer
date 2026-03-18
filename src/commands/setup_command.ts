import { Command } from 'commander';
import path from 'path';
import { appConfig } from '../config';
import { cloneOrPullRepo } from '../utils/git_helper';

/**
 * Clones or pulls a repository for indexing.
 *
 * @param repoUrl The URL of the repository to clone.
 * @param options Optional configuration including GitHub token.
 */
async function setup(repoUrl: string, options?: { githubToken?: string }) {
  const token = options?.githubToken ?? appConfig.githubToken;
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
  .option('--github-token <token>', 'GitHub token for cloning/pulling private repositories (overrides GITHUB_TOKEN)')
  .action((repoUrl, options) => setup(repoUrl, options));

export { setup };
