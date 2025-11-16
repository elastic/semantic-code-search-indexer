import { Command, Option } from 'commander';
import Database from 'better-sqlite3';
import { createLogger } from '../utils/logger';
import { resolveRepoName, getQueueDbPath } from '../utils/queue_helper';
import { CodeChunk } from '../utils/elasticsearch';

// Helper function to format bytes into a human-readable string
function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export const listFailedCommand = new Command('queue:list-failed')
  .description('Lists all documents in a queue with a "failed" status.')
  .addOption(new Option('--repo-name <repoName>', 'Repository name (auto-detects if only one repo exists)'))
  .action(async (options) => {
    const repoName = resolveRepoName(options.repoName);
    const logger = createLogger({ name: repoName, branch: 'unknown' });
    const dbPath = getQueueDbPath(repoName);

    try {
      const db = new Database(dbPath, { readonly: true });

      const selectStmt = db.prepare(`
        SELECT id, document
        FROM queue
        WHERE status = 'failed'
        ORDER BY id
      `);

      const failedDocs = selectStmt.all() as { id: number; document: string }[];

      if (failedDocs.length === 0) {
        console.log(`No failed documents found in queue '${repoName}'.`);
        return;
      }

      console.log(`Found ${failedDocs.length} failed documents in queue '${repoName}':\n`);

      for (const doc of failedDocs) {
        try {
          const parsedDoc: CodeChunk = JSON.parse(doc.document);
          const contentSize = Buffer.byteLength(parsedDoc.content, 'utf8');
          console.log(`ID: ${doc.id} | Size: ${formatBytes(contentSize)} | Path: ${parsedDoc.filePath}`);
        } catch {
          console.log(`ID: ${doc.id} | Error: Failed to parse document JSON.`);
        }
      }

      db.close();
    } catch (error) {
      logger.error(`Failed to connect to or read the database at ${dbPath}.`, { error });
      logger.error('Please ensure the --repo-name is correct and the database file exists.');
      process.exit(1);
    }
  });
