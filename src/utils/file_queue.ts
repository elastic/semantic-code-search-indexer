import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { IQueue, QueuedDocument } from './queue';
import { CodeChunk } from './elasticsearch';
import { logger } from './logger';
import _ from 'lodash';

const MAX_RETRIES = 3;

export class FileQueue implements IQueue {
  private queueDir: string;
  private processingDir: string;
  private failedDir: string;

  constructor(baseDir: string) {
    this.queueDir = path.join(baseDir, 'pending');
    this.processingDir = path.join(baseDir, 'processing');
    this.failedDir = path.join(baseDir, 'failed');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.queueDir, { recursive: true });
    await fs.mkdir(this.processingDir, { recursive: true });
    await fs.mkdir(this.failedDir, { recursive: true });
  }

  async enqueue(documents: CodeChunk[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    const fileName = `${new Date().toISOString()}_${uuidv4()}.json`;
    const filePath = path.join(this.queueDir, fileName);
    await fs.writeFile(filePath, JSON.stringify(documents, null, 2));
    logger.info(`Enqueued batch of ${documents.length} documents to ${fileName}`);
  }

  async dequeue(count: number): Promise<QueuedDocument[]> {
    const allFiles = await fs.readdir(this.queueDir);
    if (allFiles.length === 0) {
      return [];
    }

    const filesToProcess = allFiles.slice(0, count);
    const allDocuments: QueuedDocument[] = [];

    for (const fileName of filesToProcess) {
      const originalPath = path.join(this.queueDir, fileName);
      const processingPath = path.join(this.processingDir, fileName);
      try {
        await fs.rename(originalPath, processingPath);
        const content = await fs.readFile(processingPath, 'utf-8');
        const documents: CodeChunk[] = JSON.parse(content);
        
        documents.forEach(doc => {
          allDocuments.push({
            id: fileName, // The file name acts as the batch ID
            document: doc,
          });
        });
      } catch (error) {
        logger.error('Error during dequeue, moving file back to queue', { file: fileName, error });
        try {
          await fs.rename(processingPath, originalPath);
        } catch (renameError) {
          logger.error('Failed to move file back to queue', { file: fileName, renameError });
        }
      }
    }
    return allDocuments;
  }

  async commit(documents: QueuedDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    const fileNames = _.uniq(documents.map(d => d.id));
    for (const fileName of fileNames) {
      const filePath = path.join(this.processingDir, fileName);
      try {
        await fs.unlink(filePath);
        logger.info(`Committed and deleted batch file: ${fileName}`);
      } catch (error) {
        logger.error('Failed to commit batch file', { file: fileName, error });
      }
    }
  }

  async requeue(documents: QueuedDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    const fileGroups = _.groupBy(documents, 'id');

    for (const fileName in fileGroups) {
      const processingPath = path.join(this.processingDir, fileName);

      const retryMatch = fileName.match(/_retry-(\d+)\.json$/);
      const retryCount = retryMatch ? parseInt(retryMatch[1], 10) + 1 : 1;

      if (retryCount >= MAX_RETRIES) {
        const failedPath = path.join(this.failedDir, fileName);
        logger.error(`Batch failed ${MAX_RETRIES} times. Moving to failed directory.`, { file: fileName });
        await fs.rename(processingPath, failedPath);
        continue;
      }

      const newFileName = fileName.replace(/(_retry-\d+)?\.json$/, `_retry-${retryCount}.json`);
      const requeuePath = path.join(this.queueDir, newFileName);
      
      logger.warn(`Requeuing batch file: ${fileName} as ${newFileName}`);
      await fs.rename(processingPath, requeuePath);
    }
  }
}