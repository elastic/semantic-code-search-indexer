# GCP Deployment Guide: Multi-Repo Incremental Indexer Service

This guide outlines how to deploy the semantic code indexer on a Google Cloud Platform (GCP) VM as a periodic, multi-repository service.

The setup consists of a single main component managed by `systemd`:

1.  **A periodic producer timer (`indexer-producer.timer`):** This timer triggers a "one-shot" service that, for each configured repository, scans for changes, enqueues them, and then immediately processes the queue to update the search index.

## Creating a GCP VM with gcloud

You can create a new VM instance using the `gcloud` command-line tool. Here is a sample command to create a Debian 11 VM suitable for running the indexer:

```bash
gcloud compute instances create indexer-vm \
  --project="your-gcp-project-id" \
  --zone="us-central1-a" \
  --machine-type="e2-medium" \
  --image-family="debian-11" \
  --image-project="debian-cloud" \
  --boot-disk-size="50GB" \
  --tags="http-server,https-server" \
  --scopes="https://www.googleapis.com/auth/cloud-platform"
```

### Command Breakdown:

*   `gcloud compute instances create indexer-vm`: The basic command to create a new VM named `indexer-vm`.
*   `--project`: Your GCP project ID.
*   `--zone`: The GCP zone where the VM will be created (e.g., `us-central1-a`).
*   `--machine-type`: The size of the VM. `e2-medium` is a good starting point.
*   `--image-family` & `--image-project`: Specifies the operating system image. This example uses Debian 11.
*   `--boot-disk-size`: The size of the boot disk.
*   `--tags`: Network tags for firewall rules.
*   `--scopes`: API access scopes for the VM. `cloud-platform` provides full access to GCP services, which might be needed for other integrations.

After running this command, you can SSH into your new VM using:

```bash
gcloud compute ssh indexer-vm --project="your-gcp-project-id" --zone="us-central1-a"
```

## Initial Server Setup

Once you have SSH'd into your VM, you need to install the necessary dependencies.

### 1. Update Package Manager

First, update your package manager's list of available packages:

```bash
sudo apt-get update
```

### 2. Install Essential Tools

Install `git` for version control, `tmux` for managing persistent sessions, and `build-essential` which is required for many `npm` packages that need to be compiled from source.

```bash
sudo apt-get install -y git tmux build-essential
```

### 3. Install Node.js v20

The indexer requires Node.js v20 or higher. The following commands will add the official NodeSource repository and install the latest Node.js v20.

```bash
# Download and execute the NodeSource setup script
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install Node.js
sudo apt-get install -y nodejs
```

### 4. Verify Installation

You can verify that everything was installed correctly by checking the versions:

```bash
node -v
npm -v
git --version
```

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

# Path to the git executable (required for systemd service)
GIT_PATH="/usr/bin/git"

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

## 2. The Multi-Repo Runner Script

The `scripts/run_multi_producer.sh` script is the heart of the producer service. It is responsible for:
1.  Reading the `REPOSITORIES_TO_INDEX` variable.
2.  For each repository, running the `incremental-index` command to find and enqueue changes.
3.  For each repository, immediately running the `index-worker` command to process the corresponding queue.

This script is already included in the project, so you do not need to create it.

## 3. Create systemd Service and Timer Files

You will create two files in `/etc/systemd/system/`.

### a. Producer Service (`indexer-producer.service`)

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

# Disable the default timeout, as indexing all repos can be a long-running job.
TimeoutStartSec=0

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

3.  **Enable and Start the Timer:** You only need to start the timer. The timer will trigger the producer service, which handles the entire indexing pipeline for all repositories.
    ```sh
    sudo systemctl enable indexer-producer.timer
    sudo systemctl start indexer-producer.timer
    ```

4.  **Check the Status:**
    ```sh
    # Check the timer and see when it will next run
    sudo systemctl list-timers

    # Check the status of the producer service
    sudo systemctl status indexer-producer.service

    # View the logs for the producer service to see the progress of all repositories
    sudo journalctl -u indexer-producer.service -f
    ```
