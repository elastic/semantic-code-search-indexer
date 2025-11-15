import './config'; // Must be the first import
import { Command } from 'commander';
import { bulkIncrementalIndexCommand } from './commands/bulk_incremental_index_command';
import { bulkReindexCommand } from './commands/bulk_reindex_command';
import { clearQueueCommand } from './commands/clear_queue_command';
import { dumpTreeCommand } from './commands/dump_tree_command';
import { incrementalIndexCommand } from './commands/incremental_index_command';
import { indexCommand } from './commands/index_command';
import { listFailedCommand } from './commands/list_failed_command';
import { monitorQueueCommand } from './commands/monitor_queue_command';
import { referencesCommand } from './commands/references_command';
import { retryFailedCommand } from './commands/retry_failed_command';
import { setupCommand } from './commands/setup_command';
import { workerCommand } from './commands/worker_command';
import { scaffoldLanguageCommand } from './commands/scaffold_language_command';
import { shutdown } from './utils/otel_provider';
import { validateAllLanguageConfigurations } from './languages';

async function main() {
  // Validate all language configurations at startup
  validateAllLanguageConfigurations();

  const program = new Command();

  program.name('code-indexer').version('1.0.0').description('A CLI for indexing codebases into Elasticsearch');

  program.addCommand(bulkIncrementalIndexCommand);
  program.addCommand(bulkReindexCommand);
  program.addCommand(clearQueueCommand);
  program.addCommand(dumpTreeCommand);
  program.addCommand(incrementalIndexCommand);
  program.addCommand(indexCommand);
  program.addCommand(listFailedCommand);
  program.addCommand(monitorQueueCommand);
  program.addCommand(referencesCommand);
  program.addCommand(retryFailedCommand);
  program.addCommand(setupCommand);
  program.addCommand(workerCommand);
  program.addCommand(scaffoldLanguageCommand);

  await program.parseAsync(process.argv);
}

// Graceful shutdown handlers
/**
 * Handles graceful shutdown of the application.
 *
 * Flushes any pending OpenTelemetry logs to the collector before exiting.
 * Called on SIGTERM and SIGINT signals to ensure clean application termination.
 *
 * @param signal - The signal name that triggered the shutdown (e.g., 'SIGTERM', 'SIGINT').
 */
async function handleShutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  try {
    await shutdown();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

main()
  .then(async () => {
    await shutdown();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('An error occurred:', error);
    await shutdown();
    process.exit(1);
  });
