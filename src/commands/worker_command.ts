import { IndexerWorker } from '../utils/indexer_worker';
import { appConfig, indexingConfig } from '../config';
import { logger } from '../utils/logger';
import { IQueue } from '../utils/queue';
import { SqliteQueue } from '../utils/sqlite_queue';

/**
 * The main function for the `index-worker` command.
 *
 * This function initializes the appropriate queue based on the application
 * mode and starts the IndexerWorker to process documents from the queue.
 *
 * @param concurrency The number of parallel workers to run.
 */
export async function worker(concurrency: number = 1, watch: boolean = false) {
  logger.info('Starting indexer worker process', { concurrency });

  const queue = new SqliteQueue(appConfig.queueDir);
  await queue.initialize();

  const indexerWorker = new IndexerWorker(queue, indexingConfig.batchSize, concurrency, watch);

  await indexerWorker.start();

  // Keep the process alive until the worker stops itself
  await indexerWorker.onIdle();
  logger.info('Worker has finished processing the queue.');
}
