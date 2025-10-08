
import { incrementalIndex } from '../src/commands/incremental_index_command';
import * as elasticsearch from '../src/utils/elasticsearch';
import simpleGit from 'simple-git';
import { IQueue } from '../src/utils/queue';
import { SqliteQueue } from '../src/utils/sqlite_queue';
import { Worker } from 'worker_threads';

jest.mock('simple-git');
jest.mock('../src/utils/elasticsearch');
jest.mock('../src/utils/sqlite_queue');
jest.mock('worker_threads');

const mockedSimpleGit = simpleGit as jest.Mock;
const mockedElasticsearch = elasticsearch as jest.Mocked<typeof elasticsearch>;
const mockedSqliteQueue = SqliteQueue as jest.MockedClass<typeof SqliteQueue>;
const mockedWorker = Worker as jest.MockedClass<typeof Worker>;

describe('incrementalIndex', () => {
  let workQueue: jest.Mocked<IQueue>;
  const gitInstance = {
    revparse: jest.fn().mockResolvedValue('main'),
    remote: jest.fn().mockResolvedValue('https://github.com/test/repo.git'),
    pull: jest.fn().mockResolvedValue(undefined),
    diff: jest.fn().mockResolvedValue(''),
    add: jest.fn().mockReturnThis(),
    commit: jest.fn().mockReturnThis(),
    push: jest.fn().mockReturnThis(),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let postedMessages: any[];

  beforeEach(() => {
    jest.clearAllMocks();
    postedMessages = [];

    workQueue = {
      enqueue: jest.fn(),
      dequeue: jest.fn(),
      commit: jest.fn(),
      requeue: jest.fn(),
    };

    mockedSqliteQueue.mockImplementation(() => ({
      ...workQueue,
      initialize: jest.fn(),
      close: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedSimpleGit.mockReturnValue(gitInstance as any);

    mockedElasticsearch.getLastIndexedCommit.mockResolvedValue('dummy-commit-hash');

    // Mock the worker implementation
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mockedWorker.mockImplementation(((path: string | URL) => {
      const worker = {
        on: jest.fn((event, cb) => {
          if (event === 'message') {
            // Immediately call the callback with a success message
            // to simulate the worker finishing its job.
            setTimeout(() => cb({ status: 'success', data: [] }), 0);
          }
        }),
        postMessage: jest.fn((message) => {
          postedMessages.push(message);
        }),
        terminate: jest.fn(),
        ref: jest.fn(),
        unref: jest.fn(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return worker as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
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
        revparse: jest.fn()
          .mockResolvedValueOnce('main') // gitBranch
          .mockResolvedValueOnce('/test/repo') // gitRoot
          .mockResolvedValueOnce('new-commit-hash'), // newCommitHash
        remote: jest.fn().mockResolvedValue('https://github.com/test/repo.git'),
        pull: jest.fn().mockResolvedValue(undefined),
        diff: jest.fn().mockResolvedValue(gitDiffOutput),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedSimpleGit.mockReturnValue(git as any);
    mockedElasticsearch.getLastIndexedCommit.mockResolvedValue('old-commit-hash');

    await incrementalIndex('/test/repo');

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

    const indexedFiles = postedMessages.map(msg => msg.relativePath);
    expect(indexedFiles).toHaveLength(4);
    expect(indexedFiles).toContain('src/new_file.ts');
    expect(indexedFiles).toContain('src/copied_file.ts');
    expect(indexedFiles).toContain('src/added_file.ts');
    expect(indexedFiles).toContain('src/modified_file.ts');
  });
});
