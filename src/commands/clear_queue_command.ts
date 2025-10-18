import { Command, Option } from 'commander';
import { appConfig } from '../config';
import Database from 'better-sqlite3';
import path from 'path';
import { createLogger } from '../utils/logger';
import fs from 'fs';

async function clearQueue(options?: { repoName?: string }) {
  const logger = options?.repoName 
    ? createLogger({ name: options.repoName, branch: 'unknown' })
    : createLogger();

  const queueDir = options?.repoName 
    ? path.join(appConfig.queueBaseDir, options.repoName)
    : appConfig.queueDir;
  const dbPath = path.join(queueDir, 'queue.db');

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
    .addOption(
      new Option(
        '--repo-name <repoName>',
        'Optional: The name of the repository to clear. If not provided, clears the default queue.'
      )
    )
    .action(clearQueue);