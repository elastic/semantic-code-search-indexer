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

# OpenTelemetry Configuration (optional)
# Enable logs and metrics export to OpenTelemetry Collector
OTEL_LOGGING_ENABLED="true"
OTEL_METRICS_ENABLED="true"
OTEL_SERVICE_NAME="semantic-code-search-indexer"
OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4318"
# Optional: separate endpoints for logs and metrics
# OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="http://otel-collector:4318/v1/logs"
# OTEL_EXPORTER_OTLP_METRICS_ENDPOINT="http://otel-collector:4318/v1/metrics"
# Optional: authentication headers
# OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer your-token"
# Optional: metric export interval (default: 60000ms = 60s)
# OTEL_METRIC_EXPORT_INTERVAL_MILLIS="60000"

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

## 4. Monitoring and Observability

### OpenTelemetry Collector Deployment

For production monitoring, deploy an OpenTelemetry Collector to receive logs and metrics from the indexer. The collector buffers telemetry data, adds resource attributes, and exports to Elasticsearch.

1.  **Download and Install OpenTelemetry Collector:**

    ```bash
    # Download the latest collector-contrib release
    wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.91.0/otelcol-contrib_0.91.0_linux_amd64.tar.gz
    tar -xzf otelcol-contrib_0.91.0_linux_amd64.tar.gz
    sudo mv otelcol-contrib /usr/local/bin/
    ```

2.  **Create Collector Configuration:**

    Copy the example collector configuration from the repository:

    ```bash
    sudo mkdir -p /etc/otelcol
    sudo cp /opt/semantic-code-search-indexer/docs/otel-collector-config.yaml /etc/otelcol/config.yaml
    ```

    Edit the configuration to add your Elasticsearch credentials:

    ```bash
    sudo nano /etc/otelcol/config.yaml
    ```

3.  **Create systemd Service for Collector:**

    Create `/etc/systemd/system/otelcol.service`:

    ```ini
    [Unit]
    Description=OpenTelemetry Collector
    After=network.target

    [Service]
    Type=simple
    ExecStart=/usr/local/bin/otelcol-contrib --config=/etc/otelcol/config.yaml
    Restart=on-failure
    RestartSec=30
    Environment="ELASTICSEARCH_ENDPOINT=https://your-es-endpoint.elastic-cloud.com:9243"
    Environment="ELASTICSEARCH_API_KEY=YourEncodedApiKey"

    [Install]
    WantedBy=multi-user.target
    ```

4.  **Start the Collector:**

    ```bash
    sudo systemctl daemon-reload
    sudo systemctl enable otelcol
    sudo systemctl start otelcol
    sudo systemctl status otelcol
    ```

### Elasticsearch Data Streams

The indexer exports telemetry to the following Elasticsearch data streams:
- **Logs**: `logs-semanticcode.otel-default`
- **Metrics**: `metrics-semanticcode.otel-default`

These follow Elasticsearch's data stream naming conventions:
- `logs-*` / `metrics-*`: Type prefix
- `semanticcode.otel`: Dataset identifier
- `default`: Namespace

### Creating Repository-Specific Dashboards

All logs and metrics include `repo.name` and `repo.branch` attributes, enabling repository-specific monitoring:

1.  **Access Kibana Discover:**
    Navigate to Kibana → Discover

2.  **Filter by Repository:**
    ```
    repo.name: "kibana" AND repo.branch: "main"
    ```

3.  **Create Visualizations:**
    Use Kibana's visualization tools to create charts for:
    - **Files processed over time**: `parser.files.processed` metric
    - **Queue depth**: `queue.size.pending` gauge
    - **Batch processing duration**: `indexer.batch.duration` histogram
    - **Indexing failures**: `indexer.batch.failed` counter

4.  **Build Dashboards:**
    Combine visualizations into repository-specific dashboards:
    - Overview dashboard: All repositories
    - Per-repository dashboards: Filter by `repo.name`
    - Per-branch dashboards: Filter by `repo.name` and `repo.branch`

### Alerting

Set up alerts in Kibana for:
- **High failure rate**: `indexer.batch.failed` / `indexer.batch.processed` > 0.1
- **Queue backlog**: `queue.size.pending` > 10000
- **Stale processing**: No `parser.files.processed` metrics in last hour

### Key Metrics to Monitor

| Metric | What to Watch | Alert Threshold |
|--------|---------------|-----------------|
| `parser.files.processed` | Files indexed per minute | < 10/min may indicate issues |
| `queue.size.pending` | Documents waiting to be indexed | > 10000 indicates backlog |
| `indexer.batch.failed` | Failed batch operations | > 5% failure rate |
| `indexer.batch.duration` | Indexing performance | P95 > 30s may indicate ES issues |

