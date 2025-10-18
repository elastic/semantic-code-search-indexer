import { Command, Option } from 'commander';
import path from 'path';
import Database from 'better-sqlite3';
import { createLogger } from '../utils/logger';
import { appConfig } from '../config';

export const retryFailedCommand = new Command('queue:retry-failed')
  .description('Reset all "failed" documents in a queue back to "pending" to be retried.')
  .addOption(
    new Option(
      '--repo-name <repoName>',
      'The name of the repository for which to retry failed documents.'
    ).makeOptionMandatory()
  )
  .action(async (options) => {
    const { repoName } = options;
    const logger = createLogger({ name: repoName, branch: 'unknown' });
    const queueDir = path.join(appConfig.queueBaseDir, repoName);
    const dbPath = path.join(queueDir, 'queue.db');

    logger.info(`Connecting to queue database at: ${dbPath}`);

    try {
      const db = new Database(dbPath);

      // First, get a count of failed documents for reporting.
      const countStmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM queue
        WHERE status = 'failed'
      `);
      const result = countStmt.get() as { count: number };
      const failedCount = result.count;

      if (failedCount === 0) {
        logger.info('No failed documents found. Nothing to do.');
        return;
      }

      logger.info(`Found ${failedCount} failed documents. Resetting them to 'pending'...`);

      // Now, execute the update.
      const updateStmt = db.prepare(`
        UPDATE queue
        SET status = 'pending', retry_count = 0
        WHERE status = 'failed'
      `);
      
      const info = updateStmt.run();

      logger.info(`Successfully reset ${info.changes} documents. They will be picked up by the worker on its next run.`);
      
      db.close();
    } catch (error) {
      logger.error(`Failed to connect to or update the database at ${dbPath}.`, { error });
      logger.error('Please ensure the --repo-name is correct and the database file exists.');
      process.exit(1);
    }
  });