#!/bin/bash
set -e

################################################################################
# Comprehensive Migration: 2025-11-16 - Unified Index Command
################################################################################
#
# This script intelligently migrates ALL queue structures and cron jobs.
# Handles all permutations: .queue/ only, .queues/ only, or both.
# Creates backups and supports rollback if anything goes wrong.
#
################################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BACKUP_DIR="$PROJECT_ROOT/.migration-backup-$(date +%Y%m%d-%H%M%S)"

echo "=== Unified Index Command Migration ==="
echo ""
echo "This script will:"
echo "  1. Analyze your current queue structure"
echo "  2. Create backups"
echo "  3. Migrate queues to new structure"
echo "  4. Update cron jobs"
echo "  5. Provide rollback instructions if needed"
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"
echo "Backup directory: $BACKUP_DIR"
echo ""

# Function to backup a directory
backup_dir() {
  local dir=$1
  local name=$2
  if [ -d "$dir" ]; then
    echo "Backing up $name..."
    cp -r "$dir" "$BACKUP_DIR/$name"
    echo "✓ Backed up to $BACKUP_DIR/$name"
  fi
}

# Function to check if queue has data
queue_has_data() {
  local db_path=$1
  if [ -f "$db_path" ]; then
    local count=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM queue;" 2>/dev/null || echo "0")
    [ "$count" -gt 0 ]
  else
    return 1
  fi
}

# Analyze current state
echo "=== Analyzing Current Setup ==="
echo ""

HAS_LEGACY_QUEUE=false
HAS_PER_REPO_QUEUES=false
LEGACY_QUEUE_PATH="$PROJECT_ROOT/.queue"
PER_REPO_QUEUE_PATH="$PROJECT_ROOT/.queues"

if [ -d "$LEGACY_QUEUE_PATH" ] && [ -f "$LEGACY_QUEUE_PATH/queue.db" ]; then
  HAS_LEGACY_QUEUE=true
  echo "✓ Found legacy queue: .queue/queue.db"
fi

if [ -d "$PER_REPO_QUEUE_PATH" ]; then
  # Check if there are any subdirectories with queue.db
  if find "$PER_REPO_QUEUE_PATH" -mindepth 2 -name "queue.db" | grep -q .; then
    HAS_PER_REPO_QUEUES=true
    echo "✓ Found per-repo queues: .queues/<repo>/queue.db"
    echo "  Repos:"
    find "$PER_REPO_QUEUE_PATH" -mindepth 2 -name "queue.db" -exec dirname {} \; | while read -r dir; do
      repo_name=$(basename "$dir")
      echo "    - $repo_name"
    done
  fi
fi

if [ "$HAS_LEGACY_QUEUE" = false ] && [ "$HAS_PER_REPO_QUEUES" = false ]; then
  echo "✓ No existing queues found. Nothing to migrate."
  echo "  You can proceed with the new version directly."
  exit 0
fi

echo ""
echo "=== Creating Backups ==="
echo ""

# Backup existing queues
if [ "$HAS_LEGACY_QUEUE" = true ]; then
  backup_dir "$LEGACY_QUEUE_PATH" "queue-legacy"
fi

if [ "$HAS_PER_REPO_QUEUES" = true ]; then
  backup_dir "$PER_REPO_QUEUE_PATH" "queues-per-repo"
fi

# Backup crontab
if command -v crontab &>/dev/null; then
  crontab -l >"$BACKUP_DIR/crontab-backup.txt" 2>/dev/null || true
  if [ -f "$BACKUP_DIR/crontab-backup.txt" ] && [ -s "$BACKUP_DIR/crontab-backup.txt" ]; then
    echo "✓ Backed up crontab to $BACKUP_DIR/crontab-backup.txt"
  fi
fi

echo ""
echo "=== Migration Strategy ==="
echo ""

# Determine migration strategy
if [ "$HAS_LEGACY_QUEUE" = true ] && [ "$HAS_PER_REPO_QUEUES" = false ]; then
  echo "Strategy: Migrate single .queue/ to .queues/<repo>/"
  echo ""

  # Ask for repo name
  read -p "Enter repository name for legacy queue: " REPO_NAME

  if [ -z "$REPO_NAME" ]; then
    echo "Error: Repository name cannot be empty"
    exit 1
  fi

  # Sanitize repo name
  REPO_NAME=$(echo "$REPO_NAME" | tr -cd '[:alnum:]_-')

  TARGET_DIR="$PER_REPO_QUEUE_PATH/$REPO_NAME"

  # Create target directory
  mkdir -p "$TARGET_DIR"

  # Copy queue
  echo "Migrating .queue/queue.db to .queues/$REPO_NAME/queue.db..."
  cp "$LEGACY_QUEUE_PATH/queue.db" "$TARGET_DIR/queue.db"

  echo "✓ Migration complete!"

elif [ "$HAS_LEGACY_QUEUE" = false ] && [ "$HAS_PER_REPO_QUEUES" = true ]; then
  echo "Strategy: Per-repo queues already exist. No queue migration needed."
  echo "  Your .queues/ structure is already correct."

elif [ "$HAS_LEGACY_QUEUE" = true ] && [ "$HAS_PER_REPO_QUEUES" = true ]; then
  echo "Strategy: Both .queue/ and .queues/ exist."
  echo ""
  echo "You have:"
  echo "  - Legacy queue: .queue/queue.db"
  echo "  - Per-repo queues in .queues/"
  echo ""

  # Check if legacy queue has data
  if queue_has_data "$LEGACY_QUEUE_PATH/queue.db"; then
    echo "⚠ Legacy queue contains data!"
    echo ""
    read -p "Do you want to migrate legacy queue to a new repo? (y/N): " MIGRATE_LEGACY

    if [ "$MIGRATE_LEGACY" = "y" ] || [ "$MIGRATE_LEGACY" = "Y" ]; then
      read -p "Enter repository name for legacy queue: " REPO_NAME

      if [ -z "$REPO_NAME" ]; then
        echo "Error: Repository name cannot be empty"
        exit 1
      fi

      REPO_NAME=$(echo "$REPO_NAME" | tr -cd '[:alnum:]_-')
      TARGET_DIR="$PER_REPO_QUEUE_PATH/$REPO_NAME"

      if [ -d "$TARGET_DIR" ]; then
        echo "Warning: .queues/$REPO_NAME already exists!"
        read -p "Overwrite? (y/N): " CONFIRM
        if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
          echo "Skipping legacy queue migration."
        else
          mkdir -p "$TARGET_DIR"
          cp "$LEGACY_QUEUE_PATH/queue.db" "$TARGET_DIR/queue.db"
          echo "✓ Migrated legacy queue to .queues/$REPO_NAME/"
        fi
      else
        mkdir -p "$TARGET_DIR"
        cp "$LEGACY_QUEUE_PATH/queue.db" "$TARGET_DIR/queue.db"
        echo "✓ Migrated legacy queue to .queues/$REPO_NAME/"
      fi
    else
      echo "Skipping legacy queue migration."
    fi
  else
    echo "Legacy queue is empty. It can be safely deleted."
  fi
fi

echo ""
echo "=== Cron Job Migration ==="
echo ""

# Check for cron jobs
if command -v crontab &>/dev/null; then
  CURRENT_CRONTAB=$(crontab -l 2>/dev/null || echo "")

  if echo "$CURRENT_CRONTAB" | grep -q "bulk_incremental_index.sh\|bulk:incremental-index\|bulk:reindex\|index-worker"; then
    echo "Found old cron jobs that need updating:"
    echo ""
    echo "$CURRENT_CRONTAB" | grep "bulk_incremental_index.sh\|bulk:incremental-index\|bulk:reindex\|index-worker"
    echo ""

    read -p "Would you like to migrate cron jobs now? (y/N): " MIGRATE_CRON

    if [ "$MIGRATE_CRON" = "y" ] || [ "$MIGRATE_CRON" = "Y" ]; then
      # Detect project directory from cron job or current location
      PROJECT_DIR=$(echo "$CURRENT_CRONTAB" | grep -E "bulk_incremental_index.sh|bulk:incremental-index" | head -1 | sed -n 's|.*cd \([^ ]*\).*|\1|p')

      if [ -z "$PROJECT_DIR" ]; then
        PROJECT_DIR="$PROJECT_ROOT"
      fi

      echo ""
      echo "Project directory: $PROJECT_DIR"
      echo ""

      # Check if .env file exists and has REPOSITORIES_TO_INDEX
      ENV_FILE="$PROJECT_DIR/.env"
      HAS_REPO_ENV=false

      if [ -f "$ENV_FILE" ]; then
        if grep -q "^REPOSITORIES_TO_INDEX=" "$ENV_FILE"; then
          HAS_REPO_ENV=true
          REPO_LIST=$(grep "^REPOSITORIES_TO_INDEX=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
          echo "✓ Found REPOSITORIES_TO_INDEX in .env: $REPO_LIST"
          echo ""
        fi
      fi

      # Extract schedule from old cron job
      OLD_SCHEDULE=$(echo "$CURRENT_CRONTAB" | grep -E "bulk_incremental_index.sh|bulk:incremental-index" | head -1 | awk '{print $1" "$2" "$3" "$4" "$5}')

      if [ "$HAS_REPO_ENV" = true ]; then
        # Use env var approach
        NEW_CRON="$OLD_SCHEDULE cd $PROJECT_DIR && /usr/bin/flock -n /tmp/indexer.lock npm run index -- --pull --concurrency 4 >> $PROJECT_DIR/indexer.log 2>&1"
        echo "New cron job (using REPOSITORIES_TO_INDEX from .env):"
      else
        # Need to specify repos explicitly
        echo "No REPOSITORIES_TO_INDEX found in .env file"
        read -p "Enter space-separated repository names (e.g., 'repo1 repo2'): " REPOS

        if [ -z "$REPOS" ]; then
          echo "No repositories specified. Skipping cron migration."
          echo "You can update cron manually later."
        else
          NEW_CRON="$OLD_SCHEDULE cd $PROJECT_DIR && /usr/bin/flock -n /tmp/indexer.lock npm run index -- $REPOS --pull --concurrency 4 >> $PROJECT_DIR/indexer.log 2>&1"
          echo "New cron job (with explicit repository list):"
        fi
      fi

      if [ -n "$NEW_CRON" ]; then
        echo ""
        echo "$NEW_CRON"
        echo ""

        # Optional: add token if needed
        read -p "Do you need to add a GitHub token? (y/N): " ADD_TOKEN
        if [ "$ADD_TOKEN" = "y" ] || [ "$ADD_TOKEN" = "Y" ]; then
          read -sp "Enter your GitHub token: " GH_TOKEN
          echo ""
          NEW_CRON=$(echo "$NEW_CRON" | sed "s|>> |--token $GH_TOKEN >> |")
        fi

        # Review and apply
        echo ""
        echo "=== Review Cron Changes ==="
        echo ""
        echo "OLD:"
        echo "$CURRENT_CRONTAB" | grep -E "bulk_incremental_index.sh|bulk:incremental-index|bulk:reindex|index-worker"
        echo ""
        echo "NEW:"
        echo "$NEW_CRON"
        echo ""

        read -p "Apply this change to crontab? (y/N): " APPLY_CRON

        if [ "$APPLY_CRON" = "y" ] || [ "$APPLY_CRON" = "Y" ]; then
          # Remove old cron jobs and add new one
          NEW_CRONTAB=$(echo "$CURRENT_CRONTAB" | grep -v -E "bulk_incremental_index.sh|bulk:incremental-index|bulk:reindex|index-worker")
          NEW_CRONTAB="$NEW_CRONTAB"$'\n'"$NEW_CRON"

          # Backup current crontab
          echo "$CURRENT_CRONTAB" >"$BACKUP_DIR/crontab-pre-migration.txt"

          # Apply new crontab
          echo "$NEW_CRONTAB" | crontab -

          echo ""
          echo "✓ Crontab updated successfully!"
          echo "  Old crontab backed up to: $BACKUP_DIR/crontab-pre-migration.txt"
        else
          echo ""
          echo "Cron migration skipped. You can update manually:"
          echo "  1. Run: crontab -e"
          echo "  2. Replace old line with: $NEW_CRON"
        fi
      fi
    else
      echo ""
      echo "Cron migration skipped. You can update manually later:"
      echo "  crontab -e"
    fi
  else
    echo "✓ No old cron jobs found. You're good to go!"
  fi
else
  echo "Crontab not available. Skipping cron job check."
fi

echo ""
echo "=== Migration Complete! ==="
echo ""
echo "Summary:"
echo "  - Backups created in: $BACKUP_DIR"
if [ "$HAS_LEGACY_QUEUE" = true ]; then
  echo "  - Legacy .queue/ backed up (can be deleted after verification)"
fi
echo "  - Per-repo queues in: $PER_REPO_QUEUE_PATH"
echo ""
echo "Next steps:"
echo "  1. Test the new command: npm run index -- <repo>"
echo "  2. Verify queue: npm run queue:monitor -- --repo-name=<repo>"
echo "  3. Update cron jobs if needed"
echo "  4. After 24h of successful operation, delete: rm -rf .queue"
echo ""
echo "Rollback (if needed):"
echo "  1. Stop any running indexers"
echo "  2. Restore from backup:"
echo "     cp -r $BACKUP_DIR/queue-legacy $PROJECT_ROOT/.queue"
echo "     cp -r $BACKUP_DIR/queues-per-repo $PROJECT_ROOT/.queues"
echo "  3. Restore crontab:"
echo "     crontab $BACKUP_DIR/crontab-backup.txt"
echo ""
echo "Backups will be kept in: $BACKUP_DIR"
echo "You can delete them once everything is verified."
