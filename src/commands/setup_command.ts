import { Command } from 'commander';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

async function setup(repoUrl: string) {
  const reposDir = path.join(process.cwd(), '.repos');

  if (!fs.existsSync(reposDir)) {
    fs.mkdirSync(reposDir);
  }

  const repoName = repoUrl.split('/').pop()?.replace('.git', '');
  if (!repoName) {
    console.error('Could not determine repository name from URL.');
    return;
  }

  const repoPath = path.join(reposDir, repoName);

  if (fs.existsSync(repoPath)) {
    console.log(`Repository ${repoName} already exists. Pulling latest changes...`);
    try {
      execSync(`git pull`, { cwd: repoPath, stdio: 'inherit' });
      console.log('Repository updated successfully.');
    } catch (error) {
      console.error(`Error pulling repository: ${error}`);
    }
    return;
  }

  console.log(`Cloning ${repoUrl} into ${repoPath}...`);
  try {
    execSync(`git clone ${repoUrl} ${repoPath}`, { stdio: 'inherit' });
    console.log('Repository cloned successfully.');
  } catch (error) {
    console.error(`Error cloning repository: ${error}`);
  }
}

export const setupCommand = new Command('setup')
  .description('Clones a repository to be indexed')
  .argument('<repo_url>', 'The URL of the git repository to clone')
  .action(setup);
