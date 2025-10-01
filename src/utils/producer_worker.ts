/**
 * This is a worker thread that is responsible for parsing files.
 *
 * It receives file paths from the main thread, parses them using the
 * `LanguageParser`, and then sends the resulting code chunks back to the main
 * thread.
 */
import { parentPort, workerData } from 'worker_threads';
import { LanguageParser } from './parser';
import { createLogger } from './logger';

const { repoName, gitBranch: repoBranch } = workerData;
const logger = createLogger({ name: repoName, branch: repoBranch });

const languageParser = new LanguageParser();

parentPort?.on('message', ({ filePath, gitBranch, relativePath }: { filePath: string | null, gitBranch: string, relativePath: string }) => {
  if (filePath === null) {
    parentPort?.close();
    return;
  }

  try {
    const chunks = languageParser.parseFile(filePath, gitBranch, relativePath);
    parentPort?.postMessage({ status: 'success', data: chunks, filePath });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    logger.error('Failed to parse file', { file: filePath, error: errorMessage });
    parentPort?.postMessage({ status: 'failure', error: errorMessage, filePath });
  }
});
