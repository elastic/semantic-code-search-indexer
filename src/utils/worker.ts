// src/worker.ts
import { parentPort } from 'worker_threads';
import { parseFile } from './parser';

parentPort?.on('message', ({ filePath, gitBranch, relativePath }: { filePath: string | null, gitBranch: string, relativePath: string }) => {
  if (filePath === null) {
    parentPort?.close();
    return;
  }

  try {
    const chunks = parseFile(filePath, gitBranch, relativePath);
    parentPort?.postMessage({ status: 'success', data: chunks, filePath });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    // Send a failure status back to the main thread instead of logging the error here
    parentPort?.postMessage({ status: 'failure', error: errorMessage, filePath });
  }
});
