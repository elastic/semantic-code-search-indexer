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

  # --- Create systemd override for the worker service ---
  override_dir="/etc/systemd/system/indexer-worker@$repo_name.service.d"
  override_conf="$override_dir/override.conf"

  echo "Creating systemd override at $override_conf" | systemd-cat -p info
  mkdir -p "$override_dir"

  # Create the override file to set the correct ES index and Queue Directory
  # for this specific worker instance.
  cat > "$override_conf" << EOF
[Service]
Environment="ELASTICSEARCH_INDEX=$es_index"
Environment="QUEUE_DIR=$queue_path"
EOF

  # --- Run the producer to enqueue changes for this repo ---
  echo "Running producer for $repo_name..." | systemd-cat -p info
  # The producer needs the same environment variables, but we pass them directly.
  QUEUE_DIR="$queue_path" ELASTICSEARCH_INDEX="$es_index" npm run incremental-index "$repo_path"

  echo "--- Finished processing for: $repo_name ---" | systemd-cat -p info
  echo "" | systemd-cat -p info
done

# --- Reload systemd and start workers ---
# This is done *after* the loop to avoid unnecessary reloads.
echo "Reloading systemd daemon to apply new overrides..." | systemd-cat -p info
systemctl daemon-reload

echo "Ensuring all worker services are enabled and started..." | systemd-cat -p info
for repo_config in $REPOSITORIES_TO_INDEX; do
    repo_name=$(basename "$(echo "$repo_config" | cut -d':' -f1)")
    if ! systemctl is-active --quiet "indexer-worker@$repo_name.service"; then
        echo "Starting worker service for $repo_name..." | systemd-cat -p info
        systemctl enable "indexer-worker@$repo_name.service"
        systemctl start "indexer-worker@$repo_name.service"
    else
        echo "Worker service for $repo_name is already active." | systemd-cat -p info
    fi
done

echo "All repositories processed." | systemd-cat -p info
