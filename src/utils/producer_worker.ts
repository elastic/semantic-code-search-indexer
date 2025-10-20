/**
 * This is a worker thread that is responsible for parsing files.
 *
 * It receives file paths from the main thread, parses them using the
 * `LanguageParser`, and then sends the resulting code chunks back to the main
 * thread.
 */
import { parentPort, workerData } from 'worker_threads';
import { LanguageParser, type ParseResult } from './parser';
import { createLogger } from './logger';
import { MESSAGE_STATUS_SUCCESS, MESSAGE_STATUS_FAILURE } from './constants';

const { repoName, gitBranch: repoBranch } = workerData;
const logger = createLogger({ name: repoName, branch: repoBranch });

const languageParser = new LanguageParser();

parentPort?.on('message', ({ filePath, gitBranch, relativePath }: { filePath: string | null, gitBranch: string, relativePath: string }) => {
  if (filePath === null) {
    parentPort?.close();
    return;
  }

  try {
    const result = languageParser.parseFile(filePath, gitBranch, relativePath);
    parentPort?.postMessage({
      status: MESSAGE_STATUS_SUCCESS,
      data: result.chunks,
      filePath,
      metrics: result.metrics
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    logger.error('Failed to parse file', { file: filePath, error: errorMessage });

    // Create base metric data for failure case
    const failureMetrics: ParseResult['metrics'] = {
      filesProcessed: 0,
      filesFailed: 1,
      chunksCreated: 0,
      chunksSkipped: 0,
      chunkSizes: [],
      language: '',
      parserType: ''
    };

    parentPort?.postMessage({
      status: MESSAGE_STATUS_FAILURE,
      error: errorMessage,
      filePath,
      metrics: failureMetrics
    });
  }
});
