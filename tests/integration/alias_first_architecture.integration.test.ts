import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

import { getClient, resolveAliasToIndex } from '../../src/utils/elasticsearch';
import { indexRepos } from '../../src/commands/index_command';

async function isElasticsearchAvailable(): Promise<boolean> {
  try {
    await getClient().ping();
    return true;
  } catch {
    return false;
  }
}

function initGitRepo(repoPath: string): void {
  // Keep branch deterministic for settings doc IDs.
  try {
    execSync('git init -b main', { cwd: repoPath, stdio: 'ignore' });
  } catch {
    execSync('git init', { cwd: repoPath, stdio: 'ignore' });
    const branch = execSync('git symbolic-ref --short HEAD', { cwd: repoPath }).toString().trim();
    if (branch !== 'main') {
      execSync('git checkout -b main', { cwd: repoPath, stdio: 'ignore' });
    }
  }
  execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: repoPath, stdio: 'ignore' });
}

function gitCommitAll(repoPath: string, message: string): string {
  execSync('git add .', { cwd: repoPath, stdio: 'ignore' });
  execSync(`git commit -m "${message}"`, { cwd: repoPath, stdio: 'ignore' });
  return execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
}

async function getAliasTargets(aliasName: string): Promise<string[]> {
  const client = getClient();
  try {
    const response = (await client.indices.getAlias({ name: aliasName })) as Record<string, unknown>;
    return Object.keys(response);
  } catch (error: unknown) {
    const status = (error as { meta?: { statusCode?: unknown } }).meta?.statusCode;
    if (status === 404) {
      return [];
    }
    throw error;
  }
}

async function getSettingsCommit(aliasName: string): Promise<string | null> {
  const client = getClient();
  const settingsIndex = `${aliasName}_settings`;
  try {
    const response = await client.get<{ commit_hash?: string }>({ index: settingsIndex, id: 'main' });
    return response._source?.commit_hash ?? null;
  } catch (error: unknown) {
    const status = (error as { meta?: { statusCode?: unknown } }).meta?.statusCode;
    if (status === 404) {
      return null;
    }
    throw error;
  }
}

async function putMaintenanceLock(aliasName: string, expiresAt: string): Promise<void> {
  const client = getClient();
  const settingsIndex = `${aliasName}_settings`;
  await client.index({
    index: settingsIndex,
    id: '_reindex_lock',
    document: {
      type: 'reindex_lock',
      alias: aliasName,
      lock_owner: 'integration-test',
      lock_acquired_at: new Date().toISOString(),
      lock_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    refresh: true,
  });
}

describe('Integration Test - alias-first architecture (lock + atomic swap)', () => {
  const createdRepos: string[] = [];
  const backingIndicesToDelete = new Set<string>();
  let repoPath: string;
  let aliasName: string;

  beforeAll(async () => {
    const esAvailable = await isElasticsearchAvailable();
    if (!esAvailable) {
      throw new Error(
        'Elasticsearch is not available. Run `npm run test:integration:setup` first to start Elasticsearch via Docker Compose.'
      );
    }

    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'markdown';
    process.env.DISABLE_SEMANTIC_TEXT = 'true';

    repoPath = path.join(os.tmpdir(), `test-alias-first-repo-${Date.now()}`);
    aliasName = `test-alias-first-${Date.now()}`;
    createdRepos.push(repoPath);
    fs.mkdirSync(repoPath, { recursive: true });
    initGitRepo(repoPath);

    fs.writeFileSync(path.join(repoPath, 'README.md'), '# hello\n');
    gitCommitAll(repoPath, 'Initial');
  }, 120000);

  afterAll(async () => {
    const client = getClient();
    try {
      // Best-effort: resolve and delete any current alias targets.
      for (const a of [aliasName, `${aliasName}_locations`]) {
        const targets = await getAliasTargets(a);
        targets.forEach((t) => backingIndicesToDelete.add(t));
      }
    } catch {
      // ignore
    }

    // Delete known backing indices (concrete).
    for (const idx of backingIndicesToDelete) {
      try {
        await client.indices.delete({ index: idx });
      } catch {
        // ignore
      }
    }

    // Delete settings index (concrete).
    try {
      await client.indices.delete({ index: `${aliasName}_settings` });
    } catch {
      // ignore
    }

    for (const p of createdRepos) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('should bootstrap backing indices, swap aliases, and enforce maintenance lock skipping', async () => {
    // 1) First run bootstraps: alias does not exist, so a backing index is created and swapped in.
    await indexRepos([`${repoPath}:${aliasName}`], { watch: false, concurrency: '2' });

    const mainTargets1 = await getAliasTargets(aliasName);
    const locTargets1 = await getAliasTargets(`${aliasName}_locations`);

    expect(mainTargets1).toHaveLength(1);
    expect(locTargets1).toHaveLength(1);
    expect(mainTargets1[0]).toContain(`${aliasName}-scsi-`);
    expect(locTargets1[0]).toBe(`${mainTargets1[0]}_locations`);

    backingIndicesToDelete.add(mainTargets1[0]);
    backingIndicesToDelete.add(locTargets1[0]);

    const commit1 = await getSettingsCommit(aliasName);
    expect(typeof commit1).toBe('string');
    expect(commit1 && commit1.length).toBeGreaterThan(0);

    // 2) Create a new commit, then ensure an EXPIRED lock does not block the next run.
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# hello again\n');
    const commit2Hash = gitCommitAll(repoPath, 'Update');

    const expiredExpiry = new Date(Date.now() - 60 * 1000).toISOString();
    await putMaintenanceLock(aliasName, expiredExpiry);

    await indexRepos([`${repoPath}:${aliasName}`], { watch: false, concurrency: '2' });

    const commitAfterExpiredLock = await getSettingsCommit(aliasName);
    expect(commitAfterExpiredLock).toBe(commit2Hash);

    const expiredLockStillThere = await getClient().exists({ index: `${aliasName}_settings`, id: '_reindex_lock' });
    expect(expiredLockStillThere).toBe(false);

    // 3) Create a non-expired lock, then ensure the next run is skipped and settings commit does not change.
    const futureExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await putMaintenanceLock(aliasName, futureExpiry);

    await indexRepos([`${repoPath}:${aliasName}`], { watch: false, concurrency: '2' });

    const commitAfterSkip = await getSettingsCommit(aliasName);
    expect(commitAfterSkip).toBe(commit2Hash);

    // 4) Introduce a multi-target alias state and validate resolution behavior.
    const client = getClient();
    const extraMainIndex = `${aliasName}-scsi-extra-${Date.now()}`;
    const extraLocIndex = `${extraMainIndex}_locations`;

    await client.indices.create({ index: extraMainIndex });
    await client.indices.create({ index: extraLocIndex });
    backingIndicesToDelete.add(extraMainIndex);
    backingIndicesToDelete.add(extraLocIndex);

    // Add additional targets to both aliases without configuring a write index.
    await client.indices.updateAliases({
      actions: [
        { add: { index: extraMainIndex, alias: aliasName } },
        { add: { index: extraLocIndex, alias: `${aliasName}_locations` } },
      ],
    });

    await expect(resolveAliasToIndex(aliasName)).rejects.toThrow(
      new RegExp(`Alias \"${aliasName}\" points to multiple indices \\(.*\\) with no write index configured\\.`)
    );

    // Make the original backing index the explicit write index so clean runs can resolve it safely.
    await client.indices.updateAliases({
      actions: [{ add: { index: mainTargets1[0], alias: aliasName, is_write_index: true } }],
    });
    const resolvedWriteIndex = await resolveAliasToIndex(aliasName);
    expect(resolvedWriteIndex).toBe(mainTargets1[0]);

    // 5) Run a clean maintenance reindex with an EXPIRED lock present (acquire should clear and proceed).
    const expiredAgain = new Date(Date.now() - 60 * 1000).toISOString();
    await putMaintenanceLock(aliasName, expiredAgain);

    await indexRepos([`${repoPath}:${aliasName}`], { watch: false, clean: true, concurrency: '2' });

    const mainTargets2 = await getAliasTargets(aliasName);
    const locTargets2 = await getAliasTargets(`${aliasName}_locations`);

    expect(mainTargets2).toHaveLength(1);
    expect(locTargets2).toHaveLength(1);
    expect(mainTargets2[0]).not.toBe(mainTargets1[0]);
    expect(locTargets2[0]).toBe(`${mainTargets2[0]}_locations`);

    // By default, old indices are cleaned up.
    const existsOldMain = await getClient().indices.exists({ index: mainTargets1[0] });
    const existsOldLoc = await getClient().indices.exists({ index: `${mainTargets1[0]}_locations` });
    expect(existsOldMain).toBe(false);
    expect(existsOldLoc).toBe(false);

    const existsExtraMain = await getClient().indices.exists({ index: extraMainIndex });
    const existsExtraLoc = await getClient().indices.exists({ index: extraLocIndex });
    expect(existsExtraMain).toBe(false);
    expect(existsExtraLoc).toBe(false);

    backingIndicesToDelete.add(mainTargets2[0]);
    backingIndicesToDelete.add(locTargets2[0]);

    // Lock should be released after clean.
    const lockStillThere = await getClient().exists({ index: `${aliasName}_settings`, id: '_reindex_lock' });
    expect(lockStillThere).toBe(false);

    // Settings commit should now reflect new HEAD.
    const commit2 = await getSettingsCommit(aliasName);
    expect(commit2).not.toBe(commit1);
  }, 300000);
});
