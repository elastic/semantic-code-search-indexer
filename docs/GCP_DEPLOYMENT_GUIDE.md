# GCP Deployment Guide: Multi-Repo Incremental Indexer Service

This guide outlines how to deploy the semantic code indexer on a Google Cloud Platform (GCP) VM as a persistent, multi-repository service. This architecture is designed for scalability and isolation, dedicating a separate worker process and queue database to each repository.

The setup consists of two main components managed by `systemd`:

1.  **A templated worker service (`indexer-worker@.service`):** This allows us to easily launch and manage a dedicated worker instance for each repository (e.g., `indexer-worker@repo-one.service`). Each worker watches its own queue.
2.  **A periodic producer timer (`indexer-producer.timer`):** This timer triggers a "one-shot" service that scans all configured repositories for changes and enqueues them for their respective workers.

## Prerequisites

- A GCP project with a running VM instance (e.g., Debian 11 or Ubuntu 20.04).
- `git`, `node.js` (v20+), and `npm` installed on the VM.
- The indexer project code cloned to a directory (e.g., `/opt/semantic-code-search-indexer`).
- An Elasticsearch instance that the VM can connect to.

## 1. Configuration

### Environment File

`systemd` will manage loading our configuration. Create a `.env` file in the root of the project directory (`/opt/semantic-code-search-indexer/.env`).

The `REPOSITORIES_TO_INDEX` variable is a space-separated list. Each item is a pair containing the **absolute path** to a repository and the name of the **Elasticsearch index** it should use, separated by a colon (`:`).

```bash
# /opt/semantic-code-search-indexer/.env

# Elasticsearch Configuration
ELASTICSEARCH_ENDPOINT="https://your-es-endpoint.elastic-cloud.com:9243"
ELASTICSEARCH_API_KEY="YourEncodedApiKey"
ELASTICSEARCH_LOGGING="true"

# Application Configuration
# Base directory where all queue databases will be stored.
QUEUE_BASE_DIR="/var/lib/indexer/queues"

# Space-separated list of "repository_path:elasticsearch_index_name" pairs.
REPOSITORIES_TO_INDEX="/var/lib/indexer/repos/repo-one:repo-one-search-index /var/lib/indexer/repos/repo-two:repo-two-search-index"
```

## 2. Create the Multi-Repo Runner Script

This script is the heart of the producer service. It reads the `REPOSITORIES_TO_INDEX` variable, and for each repository it:
1.  Runs the `incremental-index` command to find and enqueue changes.
2.  Ensures a dedicated `indexer-worker` service is running for that repository.

Create this file at `/opt/semantic-code-search-indexer/scripts/run_multi_producer.sh`:

```bash
#!/bin/bash

# This script is executed by systemd, which will have already loaded the .env file.
# Navigate to the project directory
cd /opt/semantic-code-search-indexer

# Check if repositories are configured
if [ -z "$REPOSITORIES_TO_INDEX" ]; then
  echo "REPOSITORIES_TO_INDEX is not set. Exiting."
  exit 1
fi

# Loop through each "path:index" pair
for repo_config in $REPOSITORIES_TO_INDEX; do
  repo_path=$(echo "$repo_config" | cut -d':' -f1)
  es_index=$(echo "$repo_config" | cut -d':' -f2)
  repo_name=$(basename "$repo_path")
  queue_path="$QUEUE_BASE_DIR/$repo_name"

  echo "--- Processing repository: $repo_name ---"
  echo "Path: $repo_path"
  echo "Queue: $queue_path"
  echo "Index: $es_index"

  # Create the dedicated queue directory
  mkdir -p "$queue_path"

  # Run the producer to enqueue changes for this repo
  # The command will use the correct queue and ES index via environment variables
  QUEUE_DIR="$queue_path" ELASTICSEARCH_INDEX="$es_index" npm run incremental-index "$repo_path"

  # Ensure the dedicated worker service for this repo is enabled and started
  if ! systemctl is-active --quiet indexer-worker@"$repo_name".service; then
    echo "Starting worker service for $repo_name..."
    sudo systemctl enable indexer-worker@"$repo_name".service
    sudo systemctl start indexer-worker@"$repo_name".service
  fi

  echo "--- Finished processing for: $repo_name ---"
  echo ""
done
```

Make the script executable:
```sh
chmod +x /opt/semantic-code-search-indexer/scripts/run_multi_producer.sh
```

## 3. Create systemd Service and Timer Files

You will create three files in `/etc/systemd/system/`.

### a. Templated Worker Service (`indexer-worker@.service`)

This is a template unit file. The `%i` specifier will be replaced by the repository name (e.g., `repo-one`) when an instance of the service is started. It uses the new `multi-index-worker` command.

```ini
# /etc/systemd/system/indexer-worker@.service

[Unit]
Description=Semantic Code Indexer Worker for %i
After=network.target

[Service]
Type=simple
User=your_user     # Replace with the user that owns the project files
Group=your_group   # Replace with the user's group
WorkingDirectory=/opt/semantic-code-search-indexer

# Load the main environment file
EnvironmentFile=/opt/semantic-code-search-indexer/.env

# Execute the dedicated multi-worker command, passing the repository name
# The '--' is important to separate npm arguments from the command's arguments
ExecStart=/usr/bin/npm run multi-index-worker -- --watch --repo-name=%i

Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### b. Producer Service (`indexer-producer.service`)

This service executes our runner script. It also loads the `.env` file directly.

```ini
# /etc/systemd/system/indexer-producer.service

[Unit]
Description=Semantic Code Indexer Producer (Multi-Repo)

[Service]
Type=oneshot
User=your_user     # Replace with the user that owns the project files
Group=your_group   # Replace with the user's group
WorkingDirectory=/opt/semantic-code-search-indexer

# Load environment variables from the .env file
EnvironmentFile=/opt/semantic-code-search-indexer/.env

ExecStart=/opt/semantic-code-search-indexer/scripts/run_multi_producer.sh
```

### c. Producer Timer (`indexer-producer.timer`)

This timer triggers the producer service on a schedule.

```ini
# /etc/systemd/system/indexer-producer.timer

[Unit]
Description=Run the Semantic Code Indexer Producer every 15 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
Unit=indexer-producer.service

[Install]
WantedBy=timers.target
```

## 4. Deploy and Run

1.  **Build the Project:** Ensure the project is fully built by running `npm install` and `npm run build`.

2.  **Reload systemd:**
    ```sh
    sudo systemctl daemon-reload
    ```

3.  **Enable and Start the Timer:** You only need to start the timer. The timer will run the producer script, which will in turn start the necessary worker instances for each configured repository.
    ```sh
    sudo systemctl enable indexer-producer.timer
    sudo systemctl start indexer-producer.timer
    ```

4.  **Check the Status:**
    ```sh
    # Check the timer and see when it will next run
    sudo systemctl list-timers

    # After the timer has run, check the status of the workers
    sudo systemctl status 'indexer-worker@*.service'

    # View the logs for a specific worker (e.g., for repo-one)
    sudo journalctl -u indexer-worker@repo-one -f
    ```