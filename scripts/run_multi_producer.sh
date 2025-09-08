#!/bin/bash
set -e

# This script is executed by systemd, which should have already loaded the .env file
# from the indexer-producer.service definition.
# Navigate to the project directory
cd /opt/semantic-code-search-indexer

# Check if repositories are configured
if [ -z "$REPOSITORIES_TO_INDEX" ]; then
  echo "REPOSITORIES_TO_INDEX is not set. Exiting." | systemd-cat -p err
  exit 1
fi

# Loop through each "path:index" pair
for repo_config in $REPOSITORIES_TO_INDEX; do
  repo_path=$(echo "$repo_config" | cut -d':' -f1)
  es_index=$(echo "$repo_config" | cut -d':' -f2)
  repo_name=$(basename "$repo_path")
  queue_path="$QUEUE_BASE_DIR/$repo_name"

  echo "--- Processing repository: $repo_name ---" | systemd-cat -p info

  # --- Run the producer to enqueue changes for this repo ---
  echo "Running producer for $repo_name..." | systemd-cat -p info
  QUEUE_DIR="$queue_path" npm run incremental-index "$repo_path"

  # --- Run the worker to process the queue for this repo ---
  echo "Running worker for $repo_name..." | systemd-cat -p info
  QUEUE_DIR="$queue_path" ELASTICSEARCH_INDEX="$es_index" npm run index-worker

  echo "--- Finished processing for: $repo_name ---" | systemd-cat -p info
  echo "" | systemd-cat -p info
done

echo "All repositories processed." | systemd-cat -p info
