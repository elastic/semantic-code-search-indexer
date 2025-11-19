# Queue Recovery Guide

This guide explains how to diagnose and recover from queue processing issues, particularly when items get stuck in "processing" status after interrupted runs.

## Table of Contents

1. [Understanding the Queue States](#understanding-the-queue-states)
2. [Common Issues](#common-issues)
3. [Diagnosing Problems](#diagnosing-problems)
4. [Recovery Procedures](#recovery-procedures)
5. [Prevention](#prevention)
6. [Monitoring](#monitoring)

---

## Understanding the Queue States

The indexer uses a SQLite-based queue with three main states:

- **`pending`**: Items waiting to be processed
- **`processing`**: Items currently being indexed to Elasticsearch
- **`failed`**: Items that failed after 3 retry attempts

### Normal Flow

```
pending → processing → (success) → deleted from queue
                    ↓ (failure)
                    → pending (retry) → ... → failed (after 3 retries)
```

### Interrupted Flow (The Problem)

```
pending → processing → (process killed/interrupted)
                    ↓
                    → STUCK in processing forever
```

---

## Common Issues

### 1. Interrupted Enqueue Phase

**Symptoms:**

- Index command was interrupted during file scanning/enqueueing (not during processing)
- Queue has items but index is incomplete
- Running without `--clean` shows "enqueue was not completed"

**Cause:**
When the indexer process is interrupted during the enqueue phase (while scanning files and adding them to the queue), the queue contains partial data.

**Automatic Recovery:**

The indexer automatically detects interrupted enqueue and re-enqueues from scratch:

```bash
npm run index -- <repo-name>
```

**Example output:**

```bash
[INFO] Queue has pending items but enqueue was not completed for elasticsearch-js.
[INFO] Clearing partial queue and re-enqueueing from scratch...
[INFO] Enqueued batch of 150 documents
```

**How it works:**

1. **Detection**: Checks if enqueue completion flag is set in queue metadata
2. **Clear**: Removes partial queue data
3. **Re-enqueue**: Scans and enqueues all files from scratch
4. **Completion**: Marks enqueue as complete when done

**Why re-enqueue instead of resume?**

- Enqueue is fast (just file scanning and parsing)
- Processing is slow (Elasticsearch indexing)
- Simpler than deduplication logic
- No performance penalty for large codebases

**Manual Fresh Start:**

Same as automatic recovery - just run without `--clean`:

```bash
npm run index -- <repo-name>
```

Or use `--clean` to also delete the Elasticsearch index:

```bash
npm run index -- <repo-name> --clean
```

### 2. Items Stuck in "Processing" Status

**Symptoms:**

- Index command completes but some items never get indexed
- Queue appears empty but database shows items in "processing" status
- Subsequent runs don't process the stuck items

**Cause:**
When the indexer process is interrupted (Ctrl+C, timeout, crash, system shutdown), items that were being processed remain in "processing" status indefinitely.

**Impact:**

- Data loss: Stuck items are never indexed to Elasticsearch
- Silent failure: No error message indicates the problem
- Accumulates over time: Each interruption adds more stuck items

---

## Diagnosing Problems

### Check Queue Status

Use SQLite to inspect the queue state:

```bash
# Check counts by status
sqlite3 .queues/<repo-name>/queue.db "
SELECT status, COUNT(*) as count
FROM queue
GROUP BY status;
"

# Example output:
# pending|15409
# processing|8000    ← Problem: stuck items
# failed|2000
```

### Check Processing Timestamps

See when items entered "processing" status:

```bash
sqlite3 .queues/<repo-name>/queue.db "
SELECT
  status,
  MIN(processing_started_at) as oldest,
  MAX(processing_started_at) as newest,
  COUNT(*) as count
FROM queue
WHERE status = 'processing'
GROUP BY status;
"

# Example output:
# processing|2025-11-16 16:49:26|2025-11-16 16:52:28|8000
#            ↑ oldest               ↑ newest
```

If items have been in "processing" for more than 5 minutes and the indexer isn't running, they're stuck.

### Check All Repositories

List all queue directories:

```bash
ls -la .queues/
```

Check each one for stuck items.

---

## Recovery Procedures

### Method 1: Automatic Recovery (Recommended)

**As of the latest version, stale task recovery is automatic!**

The indexer worker now automatically detects and requeues stuck items at startup:

- Checks for dead worker processes (via PID tracking)
- Requeues items stuck in "processing" for more than 5 minutes
- No manual intervention required

Simply run the index command again:

```bash
npm run index -- <repo-name>
```

**Example output:**

```bash
[INFO] IndexerWorker started
[INFO] Checking 96 items in processing status for stale tasks...
[WARN] Worker process 61000 is not running. Requeuing 96 items immediately.
[WARN] Requeuing 96 stale/orphaned tasks...
[WARN] Requeued 96 documents.
[INFO] Dequeued batch of 96 documents. Active tasks: 1
```

The worker will automatically:

1. Detect items from dead processes
2. Requeue them as "pending"
3. Process them normally

### Method 2: Manual SQL Reset (Advanced)

If you prefer direct SQL manipulation:

```bash
sqlite3 .queues/<repo-name>/queue.db "
UPDATE queue
SET status = 'pending', processing_started_at = NULL
WHERE status = 'processing';
"
```

**Verify the reset:**

```bash
sqlite3 .queues/<repo-name>/queue.db "
SELECT status, COUNT(*) as count
FROM queue
GROUP BY status;
"
```

### After Recovery

Once items are reset to "pending", run the indexer normally:

```bash
npm run index -- <repo-name> --concurrency 8
```

The worker will process all pending items.

---

## Prevention

### 1. Automatic Recovery (Built-in)

The indexer automatically attempts to recover stuck items on startup:

- **Stale timeout**: 5 minutes
- **Behavior**: Items in "processing" for >5 minutes are automatically requeued
- **Logging**: Check logs for "Found N stale tasks. Re-queueing..." messages

**Note:** This only works if the process runs long enough for items to become stale. If you interrupt immediately, items won't be recovered until the next run.

### 2. Graceful Shutdown

The indexer handles SIGTERM and SIGINT signals:

```bash
# Ctrl+C will trigger graceful shutdown
npm run index -- <repo-name>
^C
# Output: Received SIGINT, shutting down gracefully...
```

**However**, graceful shutdown doesn't currently requeue in-flight items. This is a known limitation.

### 3. Use --watch Mode Carefully

Watch mode keeps the worker running indefinitely:

```bash
npm run index -- <repo-name> --watch
```

**Recommendation**: Only use `--watch` for development or continuous indexing scenarios. For one-time indexing, omit the flag so the process exits cleanly after completing the queue.

### 4. Monitor Queue Health

Regularly check queue status:

```bash
npm run queue:monitor
```

Look for:

- Items stuck in "processing" for >5 minutes
- High failure rates (>10% failed)
- Growing queue sizes

---

## Monitoring

### Queue Monitor Command

Use the built-in monitor to check queue health:

```bash
npm run queue:monitor -- --repo-name=<repo-name>
```

**Example output:**

```
Repository: elasticsearch-js
  Pending:    15409 items
  Processing: 0 items
  Failed:     2000 items
  Total:      17409 items
```

### Automated Monitoring

For production deployments, consider:

1. **Periodic health checks**: Run `queue:monitor` every 5-10 minutes
2. **Alert on stuck items**: Alert if processing count > 0 for >10 minutes
3. **Alert on high failure rate**: Alert if failed count > 10% of total
4. **Dashboard**: Track queue metrics over time

### Metrics to Track

- **Queue size by status** (pending, processing, failed)
- **Items stuck in processing > 5 minutes**
- **Requeue rate** (how often requeueStaleTasks() finds items)
- **Failed item rate** (items that hit max retries)
- **Processing duration** (time from dequeue to commit)

---

## Troubleshooting

### Problem: Items Still Stuck After Reset

**Check:**

1. Is the indexer currently running? Stop it first.
2. Are there multiple queue databases? Check `.queues/` directory.
3. Did the automatic recovery run? Check worker startup logs.

**Solution:**

```bash
# Force stop any running indexers
pkill -f "ts-node.*index"

# Run the indexer again - it will automatically recover stale items
npm run index -- <repo-name>

# Verify
sqlite3 .queues/<repo-name>/queue.db "SELECT status, COUNT(*) FROM queue GROUP BY status;"
```

### Problem: Items Keep Getting Stuck

**Possible causes:**

1. Elasticsearch connection issues (timeouts, network errors)
2. Out of memory (OOM) kills
3. System resource limits
4. Bugs in error handling

**Diagnosis:**

```bash
# Check Elasticsearch connectivity
curl -X GET "$ELASTICSEARCH_ENDPOINT/_cluster/health"

# Check system resources
top
df -h

# Check logs for errors
tail -f logs/indexer.log
```

### Problem: High Failure Rate

**Check failed items:**

```bash
npm run queue:list-failed -- --repo-name=<repo-name>
```

**Common causes:**

- Malformed documents
- Elasticsearch schema mismatches
- Network timeouts
- Resource exhaustion

**Solution:**

```bash
# Retry failed items (after fixing root cause)
npm run queue:retry-failed -- --repo-name=<repo-name>
```

### Problem: Queue Growing Without Bound

**Possible causes:**

1. Worker not running
2. Worker slower than producer
3. Elasticsearch overloaded

**Solution:**

```bash
# Increase concurrency
npm run index -- <repo-name> --concurrency 16

# Or split across multiple workers
npm run index -- <repo-name> --concurrency 8 &
npm run index -- <repo-name> --concurrency 8 &
```

---

## Technical Details

### Timestamp Handling in Stale Task Detection

The `requeueStaleTasks()` function handles timestamps in different formats:

- SQLite `CURRENT_TIMESTAMP`: `2025-11-16 16:52:05` (space separator)
- JavaScript `Date.toISOString()`: `2025-11-16T17:08:46.383Z` (ISO 8601)

The implementation normalizes timestamps before comparison by:

1. Converting SQLite format to ISO 8601 (replacing space with 'T' and appending 'Z')
2. Parsing to milliseconds for numeric comparison
3. Comparing against the stale threshold (current time - 5 minutes)

This ensures reliable detection of stuck items regardless of timestamp format.

### Stale Task Recovery Algorithm

```typescript
async requeueStaleTasks(): Promise<void> {
  const staleTimestamp = new Date(Date.now() - STALE_TIMEOUT_MS).toISOString();

  // Find items in processing for >5 minutes
  const staleTasks = db.prepare(`
    SELECT id FROM queue
    WHERE status = ? AND datetime(processing_started_at) < datetime(?)
  `).all(QUEUE_STATUS_PROCESSING, staleTimestamp);

  if (staleTasks.length > 0) {
    // Requeue them (increments retry_count)
    await this.requeue(staleTasks);
  }
}
```

Called automatically on worker startup.

---

## Related Commands

- `npm run queue:monitor -- --repo-name=<repo>` - Check queue status
- `npm run queue:clear -- --repo-name=<repo>` - Delete entire queue
- `npm run queue:list-failed -- --repo-name=<repo>` - List failed items
- `npm run queue:retry-failed -- --repo-name=<repo>` - Retry failed items

---

## Support

If you encounter issues not covered in this guide:

1. Check logs in `.queues/<repo-name>/`
2. Inspect queue database directly with SQLite
3. File an issue with:
   - Queue status output
   - Relevant log snippets
   - Steps to reproduce
