import './config'; // Must be the first import
import { Command } from 'commander';
import { 
  indexCommand, 
  referencesCommand, 
  incrementalIndexCommand, 
  setupCommand, 
  workerCommand, 
  monitorQueueCommand, 
  multiWorkerCommand, 
  clearQueueCommand,
  retryFailedCommand
} from './commands';

const program = new Command();

program
  .name('code-indexer')
  .description('A CLI for indexing and searching code repositories.');

// Register all the commands
program.addCommand(indexCommand);
program.addCommand(referencesCommand);
program.addCommand(incrementalIndexCommand);
program.addCommand(setupCommand);
program.addCommand(workerCommand);
program.addCommand(monitorQueueCommand);
program.addCommand(multiWorkerCommand);
program.addCommand(clearQueueCommand);
program.addCommand(retryFailedCommand);

async function main() {
  await program.parseAsync(process.argv);
}

main().catch(error => {
  console.error('An error occurred:', error);
  process.exit(1);
});