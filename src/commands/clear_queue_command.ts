import { Command } from 'commander';
import { appConfig } from '../config';
import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../utils/logger';
import fs from 'fs';

async function clearQueue() {
  const dbPath = path.join(appConfig.queueDir, 'queue.db');

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
    .action(clearQueue);