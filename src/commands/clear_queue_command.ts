import { Command, Option } from 'commander';
import Database from 'better-sqlite3';
import { createLogger } from '../utils/logger';
import { resolveRepoName, getQueueDbPath } from '../utils/queue_helper';
import fs from 'fs';

async function clearQueue(options?: { repoName?: string }) {
  const repoName = resolveRepoName(options?.repoName);
  const logger = createLogger({ name: repoName, branch: 'unknown' });
  const dbPath = getQueueDbPath(repoName);

  if (!fs.existsSync(dbPath)) {
    logger.info('Queue database does not exist. Nothing to clear.');
    return;
  }

  logger.info(`Opening queue database at: ${dbPath}`);
  const db = new Database(dbPath);

  try {
    logger.info('Clearing all documents from the queue...');

    const deleteStmt = db.prepare('DELETE FROM queue');
    const result = deleteStmt.run();

    logger.info(`Successfully deleted ${result.changes} documents.`);

    logger.info('Reclaiming disk space...');
    db.exec('VACUUM;');
    logger.info('Queue cleared and vacuumed successfully.');
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Failed to clear the queue database.', { error: error.message });
    } else {
      logger.error('An unknown error occurred while clearing the queue.', { error });
    }
  } finally {
    db.close();
  }
}

export const clearQueueCommand = new Command('queue:clear')
  .description('Deletes all documents from the queue')
  .addOption(new Option('--repo-name <repoName>', 'Repository name (auto-detects if only one repo exists)'))
  .action(clearQueue);
