import { Command } from 'commander';
import { appConfig } from '../config';
import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../utils/logger';
import moment from 'moment';

async function monitorQueue() {
  const dbPath = path.join(appConfig.queueDir, 'queue.db');
  const db = new Database(dbPath, { readonly: true });

  logger.info('--- Queue Monitor ---');

  try {
    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM queue');
    const total = totalStmt.get() as { count: number };
    logger.info(`Total documents: ${total.count}`);

    const pendingStmt = db.prepare("SELECT COUNT(*) as count FROM queue WHERE status = 'pending'");
    const pending = pendingStmt.get() as { count: number };
    logger.info(`Pending documents: ${pending.count}`);

    const processingStmt = db.prepare("SELECT COUNT(*) as count FROM queue WHERE status = 'processing'");
    const processing = processingStmt.get() as { count: number };
    logger.info(`Processing documents: ${processing.count}`);

    const failedStmt = db.prepare("SELECT COUNT(*) as count FROM queue WHERE status = 'failed'");
    const failed = failedStmt.get() as { count: number };
    logger.info(`Failed documents: ${failed.count}`);

    if (total.count > 0) {
        const oldestStmt = db.prepare('SELECT MIN(created_at) as date FROM queue');
        const oldest = oldestStmt.get() as { date: string };
        const age = moment.utc(oldest.date).toNow(true);
        logger.info(`Oldest document: ${oldest.date} (${age})`);

        const newestStmt = db.prepare('SELECT MAX(created_at) as date FROM queue');
        const newest = newestStmt.get() as { date: string };
        logger.info(`Newest document: ${newest.date}`);
    }

  } catch (error) {
    if (error instanceof Error) {
        logger.error('Failed to query queue database. Does it exist?', { error: error.message });
    } else {
        logger.error('An unknown error occurred while querying the queue.', { error });
    }
  } finally {
    db.close();
    logger.info('---------------------');
  }
}

export const monitorQueueCommand = new Command('queue:monitor')
  .description('Display statistics about the document queue')
  .action(monitorQueue);