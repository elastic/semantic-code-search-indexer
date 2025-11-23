import { incrementalIndex } from '../../src/commands/incremental_index_command';
import * as elasticsearch from '../../src/utils/elasticsearch';
import simpleGit from 'simple-git';
import { IQueue } from '../../src/utils/queue';
import { SqliteQueue } from '../../src/utils/sqlite_queue';
import { Worker } from 'worker_threads';
import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('simple-git');
vi.mock('../../src/utils/elasticsearch');

vi.mock('../../src/utils/sqlite_queue', () => {
  const MockSqliteQueue = vi.fn();
  return {
    SqliteQueue: MockSqliteQueue,
  };
});

vi.mock('worker_threads', () => {
  const MockWorker = vi.fn();
  return {
    Worker: MockWorker,
  };
});

const mockedSimpleGit = vi.mocked(simpleGit);
const mockedElasticsearch = vi.mocked(elasticsearch, true);
const mockedSqliteQueue = vi.mocked(SqliteQueue);
const mockedWorker = vi.mocked(Worker);

describe('incrementalIndex', () => {
  let workQueue: IQueue;
  const gitInstance = {
    revparse: vi.fn().mockResolvedValue('main'),
    remote: vi.fn().mockResolvedValue('https://github.com/test/repo.git'),
    pull: vi.fn().mockResolvedValue(undefined),
    diff: vi.fn().mockResolvedValue(''),
    add: vi.fn().mockReturnThis(),
    commit: vi.fn().mockReturnThis(),
    push: vi.fn().mockReturnThis(),
  } as unknown as ReturnType<typeof simpleGit>;

  let postedMessages: Array<{ relativePath: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    postedMessages = [];

    workQueue = {
      enqueue: vi.fn(),
      dequeue: vi.fn(),
      commit: vi.fn(),
      requeue: vi.fn(),
      clear: vi.fn(),
      markEnqueueCompleted: vi.fn(),
      isEnqueueCompleted: vi.fn().mockReturnValue(true),
    };

    mockedSqliteQueue.mockImplementation(function () {
      return {
        ...workQueue,
        initialize: vi.fn(),
        close: vi.fn(),
      };
    });

    mockedSimpleGit.mockReturnValue(gitInstance);

    mockedElasticsearch.getLastIndexedCommit.mockResolvedValue('dummy-commit-hash');

    // Note: Using function() instead of arrow function because the 'on' handler
    // needs to return a reference to the worker object itself (for chaining).
    // Arrow functions with () => ({...}) can't create the self-reference.
    mockedWorker.mockImplementation(function () {
      const worker = {
        on: vi.fn((event, cb) => {
          if (event === 'message') {
            setTimeout(() => cb({ status: 'success', data: [] }), 0);
          }
          return worker;
        }),
        postMessage: vi.fn((message) => {
          postedMessages.push(message);
        }),
        terminate: vi.fn(),
        ref: vi.fn(),
        unref: vi.fn(),
      };
      return worker;
    });
  });

  it('should handle file renames and copies correctly', async () => {
    const gitDiffOutput = [
      'R100\tsrc/old_file.ts\tsrc/new_file.ts',
      'C100\tsrc/original_file.ts\tsrc/copied_file.ts',
      'A\tsrc/added_file.ts',
      'M\tsrc/modified_file.ts',
      'D\tsrc/deleted_file.ts',
    ].join('\n');

    const git = {
      revparse: vi
        .fn()
        .mockResolvedValueOnce('main') // gitBranch
        .mockResolvedValueOnce('/test/repo') // gitRoot
        .mockResolvedValueOnce('new-commit-hash'), // newCommitHash
      remote: vi.fn().mockResolvedValue('https://github.com/test/repo.git'),
      pull: vi.fn().mockResolvedValue(undefined),
      diff: vi.fn().mockResolvedValue(gitDiffOutput),
    } as unknown as ReturnType<typeof simpleGit>;
    mockedSimpleGit.mockReturnValue(git);
    mockedElasticsearch.getLastIndexedCommit.mockResolvedValue('old-commit-hash');

    await incrementalIndex('/test/repo', { queueDir: '.test-queue' });

    // Renamed file: old path is deleted
    expect(mockedElasticsearch.deleteDocumentsByFilePath).toHaveBeenCalledWith('src/old_file.ts', undefined);

    // Modified file: deleted first, then re-indexed.
    expect(mockedElasticsearch.deleteDocumentsByFilePath).toHaveBeenCalledWith('src/modified_file.ts', undefined);

    // Deleted file: just deleted.
    expect(mockedElasticsearch.deleteDocumentsByFilePath).toHaveBeenCalledWith('src/deleted_file.ts', undefined);

    // Added file: not deleted, just indexed.
    expect(mockedElasticsearch.deleteDocumentsByFilePath).not.toHaveBeenCalledWith('src/added_file.ts', undefined);

    // New file from rename: not deleted, just indexed.
    expect(mockedElasticsearch.deleteDocumentsByFilePath).not.toHaveBeenCalledWith('src/new_file.ts', undefined);

    // Copied file: original is untouched, new file is indexed.
    expect(mockedElasticsearch.deleteDocumentsByFilePath).not.toHaveBeenCalledWith('src/copied_file.ts', undefined);
    expect(mockedElasticsearch.deleteDocumentsByFilePath).not.toHaveBeenCalledWith('src/original_file.ts', undefined);

    // Verify total deletion calls
    expect(mockedElasticsearch.deleteDocumentsByFilePath).toHaveBeenCalledTimes(3);

    // Verify that workers are created for the correct files to be indexed
    expect(mockedWorker).toHaveBeenCalledTimes(4);

    const indexedFiles = postedMessages.map((msg) => msg.relativePath);
    expect(indexedFiles).toHaveLength(4);
    expect(indexedFiles).toContain('src/new_file.ts');
    expect(indexedFiles).toContain('src/copied_file.ts');
    expect(indexedFiles).toContain('src/added_file.ts');
    expect(indexedFiles).toContain('src/modified_file.ts');
  });
});
