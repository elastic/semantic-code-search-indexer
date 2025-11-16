import fs from 'fs';
import path from 'path';
import { appConfig } from '../config';

/**
 * Auto-detect repository name if not specified
 * If only one repository exists in .queues/, use it
 * If multiple exist, require --repo-name
 */
export function resolveRepoName(repoName?: string): string {
  if (repoName) {
    return repoName;
  }

  // Check if there's only one repo in .queues/
  const queueBaseDir = appConfig.queueBaseDir;

  if (!fs.existsSync(queueBaseDir)) {
    console.error('.queues/ directory not found');
    console.error('Have you run "npm run index <repo>" yet?');
    process.exit(1);
  }

  const repos = fs.readdirSync(queueBaseDir).filter((name) => {
    const queueDbPath = path.join(queueBaseDir, name, 'queue.db');
    return fs.existsSync(queueDbPath);
  });

  if (repos.length === 1) {
    console.log(`Auto-detected repository: ${repos[0]}`);
    return repos[0];
  } else if (repos.length > 1) {
    console.error(`Multiple repositories found: ${repos.join(', ')}`);
    console.error('Please specify which repository with --repo-name');
    process.exit(1);
  } else {
    console.error('No repositories found in .queues/');
    console.error('Have you run "npm run index <repo>" yet?');
    process.exit(1);
  }
}

/**
 * Get queue directory path for a repository
 */
export function getQueueDir(repoName: string): string {
  return path.join(appConfig.queueBaseDir, repoName);
}

/**
 * Get queue database path for a repository
 */
export function getQueueDbPath(repoName: string): string {
  return path.join(getQueueDir(repoName), 'queue.db');
}
