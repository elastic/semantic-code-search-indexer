# GCP Deployment Guide: Multi-Repo Incremental Indexer Service

This guide outlines how to deploy the semantic code indexer on a Google Cloud Platform (GCP) VM as a periodic, multi-repository service.

The setup consists of a single main component managed by `systemd`:

1.  **A periodic producer timer (`indexer-producer.timer`):** This timer triggers a "one-shot" service that, for each configured repository, scans for changes, enqueues them, and then immediately processes the queue to update the search index.

## Creating a GCP VM with gcloud

You can create a new VM instance using the `gcloud` command-line tool. Here is a sample command to create a powerful Ubuntu 22.04 VM suitable for running the indexer:

```bash
gcloud compute instances create simainhacker-code-search-indexer \
  --project=$GCP_PROJECT_ID \
  --zone=us-central1-a \
  --machine-type=n2-standard-8 \
  --create-disk=auto-delete=yes,boot=yes,device-name=your-vm-name-boot-disk,disk-resource-policy=projects/your-project/regions/your-region/diskResourcePolicies/your-policy \
  --scopes=https://www.googleapis.com/auth/cloud-platform \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --description="Indexer for Semantic Code Search."
```

**Note:** You will need to replace the placeholder values for `--project` and `--disk-resource-policy` with your specific GCP project details.

After running this command, you can SSH into your new VM using:

```bash
gcloud compute ssh simainhacker-code-search-indexer --project="your-gcp-project-id" --zone="us-central1-a"
```

## Initial Server Setup

Once you have SSH'd into your VM, you need to install the necessary dependencies.

### 1. Update Package Manager

First, update your package manager's list of available packages:

```bash
sudo apt-get update
```

### 2. Install Essential Tools

Install `git` for version control, `tmux` for managing persistent sessions, `flock` for preventing cron job overlaps, and `build-essential` for compiling npm packages.

```bash
sudo apt-get install -y git tmux build-essential flock
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

- A GCP project with a running VM instance (e.g., Ubuntu 22.04).
- `git`, `node.js` (v20+), `npm`, and `flock` installed on the VM.
- The indexer project code cloned to a directory (e.g., `/opt/semantic-code-search-indexer`).
- An Elasticsearch instance that the VM can connect to.

## 1. Configuration

### Environment File

The application's configuration is managed by a `.env` file. Create this file in the root of the project directory (`/opt/semantic-code-search-indexer/.env`).

The `REPOSITORIES_TO_INDEX` variable is a space-separated list. Each item is a string containing the **absolute path** to a repository, the name of the **Elasticsearch index**, and an optional **GitHub token**, separated by colons (`:`).

```bash
# /opt/semantic-code-search-indexer/.env

# Elasticsearch Configuration
ELASTICSEARCH_ENDPOINT="https://your-es-endpoint.elastic-cloud.com:9243"
ELASTICSEARCH_API_KEY="YourEncodedApiKey"
ELASTICSEARCH_LOGGING="true"

# Application Configuration
# Base directory where all queue databases will be stored.
QUEUE_BASE_DIR="/var/lib/indexer/queues"

# Space-separated list of "repository_path:elasticsearch_index_name:token" pairs.
REPOSITORIES_TO_INDEX="/var/lib/indexer/repos/repo-one:repo-one-index /var/lib/indexer/repos/repo-two:repo-two-index:ghp_YourToken"
```

## 2. Scheduling with Cron

We will use `cron`, a standard time-based job scheduler, to run the indexer periodically. The project includes a shell script at `scripts/bulk_incremental_index.sh` which is designed to be called by the cron job.

1.  **Make the Script Executable:**
    Ensure the provided script has execute permissions.
    ```bash
    chmod +x /opt/semantic-code-search-indexer/scripts/bulk_incremental_index.sh
    ```

2.  **Open the Crontab:**
    Open the crontab file for the current user for editing.
    ```bash
    crontab -e
    ```

3.  **Add the Cron Job:**
    Add the following line to the end of the file. This configuration will run the indexer every 10 minutes.

    ```cron
    */10 * * * * /usr/bin/flock -n /tmp/bulk_indexer.lock /opt/semantic-code-search-indexer/scripts/bulk_incremental_index.sh >> /opt/semantic-code-search-indexer/bulk_incremental_index.log 2>&1
    ```

    **Command Breakdown:**
    *   `*/10 * * * *`: The schedule, meaning "at every 10th minute."
    *   `/usr/bin/flock -n /tmp/bulk_indexer.lock`: This is a crucial command for reliability. It ensures that only one instance of the script can run at a time. If a previous run is still active, the new one will not start, preventing resource contention and potential data corruption.
    *   `/opt/semantic-code-search-indexer/scripts/bulk_incremental_index.sh`: The absolute path to the script that executes the indexing process.
    *   `>> /opt/semantic-code-search-indexer/bulk_incremental_index.log 2>&1`: This redirects all output (both standard output and standard error) to a log file within the project directory. You must ensure this file is writable by the user running the cron job.

4.  **Save and Exit:**
    Save the file and exit your editor. `cron` will automatically install the new job.

## 3. Deploy and Run

1.  **Build the Project:** Ensure the project is fully built by running `npm install` and `npm run build`.

2.  **Check the Status:**
    You can check that your cron job is installed by running:
    ```bash
    crontab -l
    ```

    After the next 10-minute interval, you can check the log file for output:
    ```bash
    tail -f /opt/semantic-code-search-indexer/bulk_incremental_index.log
    ```

