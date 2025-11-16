# Migration Guide: Unified Index Command (2025-11-16)

**Target audience:** Teams running the indexer in production with cron jobs

**Migration date:** 2025-11-16  
**Affects:** Queue structure, cron jobs, CLI commands

## What Changed

**Commands consolidated:**

- `npm run index`, `npm run index-worker`, `npm run bulk:reindex`, `npm run bulk:incremental-index` → single `npm run index`

**Queue structure:**

- `.queue/queue.db` and `.queues/<repo>/` → unified `.queues/<repo>/queue.db`

**Repo syntax:**

- `path:index:token` → `repo[:index] --token <token>`

**Watch mode:**

- Was on `index-worker` command → now on `index` command (first repo only in multi-repo)

## Pre-Upgrade Checklist

Before upgrading, document your current setup:

1. **List your cron jobs:**

   ```bash
   crontab -l > ~/cron-backup.txt
   ```

2. **Check your queue state:**

   ```bash
   # If you have pending items, let them finish or note them down
   sqlite3 .queue/queue.db "SELECT COUNT(*) FROM queue WHERE status='pending';"
   ```

3. **Backup your `.env` file:**

   ```bash
   cp .env .env.backup
   ```

4. **Note your repository paths:**
   - Where are your repos located?
   - What are their names?
   - Are they using custom index names?

## Upgrade Steps

### Automated Migration (Recommended)

```bash
cd /opt/semantic-code-search-indexer  # or your install path
git fetch origin
git checkout feature/unified-index-command  # or main after merge
npm install
npm run build

# Run the smart migration script
cd scripts/migrations/2025-11-16-unified-index-command
./migrate.sh
```

The script handles:

- ✅ Queue migration (all scenarios: `.queue/` only, `.queues/` only, or both)
- ✅ Cron job updates (with prompts and preview)
- ✅ Automatic backups with timestamps
- ✅ Rollback instructions

**Scenarios covered:**

- `.queue/` only → Migrates to `.queues/<repo>/`
- `.queues/` only → No migration needed
- Both exist → Prompts to migrate or skip legacy queue

**That's it!** Skip to [Step 4: Test](#step-4-test) after running `migrate.sh`.

---

### Manual Migration (If Needed)

Only use these steps if you prefer manual control or the automated script doesn't fit your setup.

#### Step 1: Update Code

```bash
cd /opt/semantic-code-search-indexer
git fetch origin
git checkout feature/unified-index-command
npm install
npm run build
```

#### Step 2: Migrate Queue Manually

**If you only have `.queue/`:**

```bash
# 1. Backup
cp -r .queue .queue.backup

# 2. Create new structure
mkdir -p .queues/<your-repo-name>
cp .queue/queue.db .queues/<your-repo-name>/queue.db

# 3. Verify
npm run queue:monitor -- --repo-name=<your-repo-name>
```

**If you have both `.queue/` and `.queues/`:**

```bash
# 1. Check if legacy queue has data
sqlite3 .queue/queue.db "SELECT COUNT(*) FROM queue;"

# 2. If empty, delete it:
rm -rf .queue

# 3. If it has data, decide:
#    - Migrate to new repo: cp .queue/queue.db .queues/<new-repo>/queue.db
#    - Or discard: rm -rf .queue (if data is no longer needed)
```

**If you only have `.queues/`:**

- ✅ Already using new structure. No migration needed.

#### Step 3: Update Cron Jobs Manually

1. Open crontab:

   ```bash
   crontab -e
   ```

2. Replace old cron job:

   ```cron
   # OLD (remove this):
   */10 * * * * cd /opt/semantic-code-search-indexer && ./scripts/bulk_incremental_index.sh >> /opt/semantic-code-search-indexer/indexer.log 2>&1

   # NEW (add this):
   */10 * * * * cd /opt/semantic-code-search-indexer && /usr/bin/flock -n /tmp/indexer.lock npm run index -- --pull --concurrency 4 >> /opt/semantic-code-search-indexer/indexer.log 2>&1
   ```

3. For multiple repos, use `REPOSITORIES_TO_INDEX` in `.env`:
   ```bash
   # In .env file:
   REPOSITORIES_TO_INDEX="repo1 repo2 repo3"
   ```

---

### Step 4: Test

**Before the next cron run, test manually:**

```bash
cd /opt/semantic-code-search-indexer

# Test with your actual repos
npm run index -- <your-repo-path> --pull --concurrency 4

# Check logs
tail -f indexer.log

# Verify queue
npm run queue:monitor -- --repo-name=<your-repo-name>
```

### Step 5: Monitor First Cron Run

Wait for the next cron trigger and monitor:

```bash
# Watch logs
tail -f /opt/semantic-code-search-indexer/indexer.log

# Check queue
npm run queue:monitor

# Verify cron is running
ps aux | grep "npm run index"
```

---

### Step 6: Cleanup (After 24h Verification)

Once everything works:

```bash
# Remove old queue directory
rm -rf .queue .queue.backup

# Remove old scripts
rm -f scripts/bulk_incremental_index.sh
```

---

## Rollback Plan

If something goes wrong (automated migration creates timestamped backups automatically):

```bash
cd /opt/semantic-code-search-indexer

# 1. Stop cron
crontab -e  # Comment out new job with #

# 2. Revert code
git checkout <previous-commit>
npm install && npm run build

# 3. Restore from backup (if using migrate.sh)
# Check: ls -la .queue-backups/
cp -r .queue-backups/<timestamp>/.queue .queue

# 4. Restore old cron
crontab -e  # Uncomment old job
```

---

## Common Issues

### "Multiple repositories found"

**Symptom:** Queue commands fail with "Multiple repositories found: repo1, repo2"

**Solution:** Specify `--repo-name`:

```bash
npm run queue:monitor -- --repo-name=repo1
```

### "No repositories found in .queues/"

**Symptom:** First run after upgrade

**Solution:** Normal. Run `npm run index -- <repo>` once to create queue.

### Cron job not running

```bash
# Verify cron
crontab -l

# Check logs
grep CRON /var/log/syslog

# Test manually
cd /opt/semantic-code-search-indexer && npm run index -- --pull
```

### "Queue has pending items but enqueue was not completed"

**Symptom:** Interrupted during file scan

**Solution:** Automatic. Indexer clears partial queue and re-enqueues. Let it run.

---

## Getting Help

- **Logs:** `tail -f /opt/semantic-code-search-indexer/indexer.log`
- **Queue status:** `npm run queue:monitor`
- **Queue recovery:** `docs/QUEUE_RECOVERY.md`
- **File an issue:** Include logs, cron config, error messages

---

## FAQ

**Q: Do I need to delete my Elasticsearch index?**  
A: No. Works with existing indexes.

**Q: Will incremental indexing still work?**  
A: Yes. Auto-detects and uses incremental mode.

**Q: Can I run multiple repos in parallel?**  
A: No. Processes repos sequentially. Use separate cron jobs for parallel.

**Q: What about the `--watch` flag?**  
A: For cron jobs, omit `--watch`. Only use for long-running processes. Applies to first repo only in multi-repo.

**Q: Do I need to change Elasticsearch config?**  
A: No. All settings remain the same.
