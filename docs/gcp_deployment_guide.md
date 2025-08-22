# GCP Deployment Guide (Cron-based Indexer)

This guide provides step-by-step instructions for deploying the code indexer to a GCP Compute Engine VM and running it on a schedule using `systemd` timers or a standard `cron` job. This setup is ideal for periodically running the incremental indexer to keep your Elasticsearch index up-to-date with a git repository.

## Architecture Overview

-   **Scheduled Worker (Compute Engine VM)**: An "always-on" virtual machine that stores the target git repository. A `systemd` timer or `cron` job triggers the incremental indexer script at a regular interval (e.g., every 5 minutes). The script pulls the latest changes from the repository, identifies changes since the last run, and updates the Elasticsearch index accordingly.

## Prerequisites

-   A GCP account with billing enabled.
-   The `gcloud` CLI installed and authenticated.
-   A GitHub repository you want to index.
-   An Elasticsearch instance accessible from your GCP project.

## 1. GCP Project Setup

1.  **Enable the required APIs**:
    ```bash
    gcloud services enable compute.googleapis.com
    gcloud services enable logging.googleapis.com
    ```

## 2. Deploy the Worker to a Compute Engine VM

1.  **Create a VM Instance**:
    Choose a machine type appropriate for your workload. An `e2-medium` is a good starting point.
    ```bash
    export GCP_PROJECT_ID=$(gcloud config get-value project)
    gcloud compute instances create scheduled-indexer-worker \
        --project=$GCP_PROJECT_ID \
        --zone=us-central1-a \
        --machine-type=e2-medium \
        --boot-disk-size=100GB \
        --scopes=https://www.googleapis.com/auth/cloud-platform \
        --image-family=ubuntu-2204-lts \
        --image-project=ubuntu-os-cloud
    ```
    *The `--scopes` flag grants the VM access to other GCP services.*

2.  **SSH into the VM**:
    ```bash
    gcloud compute ssh scheduled-indexer-worker --zone=us-central1-a
    ```

3.  **Install Dependencies on the VM**:
    Once inside the VM, run the following:
    ```bash
    # Install Node.js (e.g., version 20)
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs

    # Install git
    sudo apt-get install -y git
    ```

4.  **Clone and Set Up the `code-indexer` Project**:
    ```bash
    # Clone your code-indexer repository
    git clone <your-code-indexer-repo-url>
    cd code-indexer

    # Install dependencies
    npm install

    # Build the project
    npm run build
    ```

5.  **Perform the Initial Clone and Index of the Target Repository**:
    This is the one-time setup for your target repository (e.g., Kibana).
    ```bash
    # Run the setup command for the target repo
    # This clones the repo into the `.repos/` directory
    npm run setup -- <your-large-repo-url>

    # Run the initial full index
    # This will take a long time for a large repo
    npm run index -- .repos/<your-large-repo-name>
    ```

## 3. Configure the Scheduled Task

You can use either `systemd` timers (recommended for robustness) or a traditional `cron` job.

### Option A: Using `systemd` Timers (Recommended)

This method is more robust as it provides better logging and management capabilities.

1.  **Create a `.env` file** in the `code-indexer` directory on the VM to hold your environment variables.
    ```ini
    # /home/<your_username>/code-indexer/.env
    # --- Elasticsearch Configuration ---
    ELASTICSEARCH_CLOUD_ID=<your-cloud-id>
    ELASTICSEARCH_API_KEY=<your-base64-encoded-api-key>
    ```

2.  **Create a `systemd` service file**:
    This file defines the service to be run.
    ```bash
    sudo nano /etc/systemd/system/incremental-indexer.service
    ```
    Paste the following content, replacing `<your_username>` and `<your_repo_name>`:
    ```ini
    [Unit]
    Description=Code Indexer Incremental Runner
    Wants=incremental-indexer.timer

    [Service]
    Type=oneshot
    User=<your_username>
    WorkingDirectory=/home/<your_username>/code-indexer
    EnvironmentFile=/home/<your_username>/code-indexer/.env
    ExecStart=/usr/bin/npm run incremental-index -- .repos/<your_repo_name>

    [Install]
    WantedBy=multi-user.target
    ```

3.  **Create a `systemd` timer file**:
    This file defines when the service should run.
    ```bash
    sudo nano /etc/systemd/system/incremental-indexer.timer
    ```
    Paste the following content. `OnCalendar=*:0/5` runs the service every 5 minutes.
    ```ini
    [Unit]
    Description=Run Incremental Indexer every 5 minutes
    Requires=incremental-indexer.service

    [Timer]
    Unit=incremental-indexer.service
    OnCalendar=*:0/5

    [Install]
    WantedBy=timers.target
    ```

4.  **Enable and start the timer**:
    ```bash
    sudo systemctl daemon-reload
    sudo systemctl enable incremental-indexer.timer
    sudo systemctl start incremental-indexer.timer
    ```

5.  **Check the status and logs**:
    ```bash
    # Check the timer status
    sudo systemctl status incremental-indexer.timer

    # View the logs of the last run
    journalctl -u incremental-indexer.service -f
    ```

### Option B: Using `cron`

This is a simpler but less flexible method.

1.  **Open the crontab editor**:
    ```bash
    crontab -e
    ```

2.  **Add the cron job**:
    Add the following line to the file to run the indexer every 5 minutes. Replace `<your_username>` and `<your_repo_name>`.
    ```cron
    */5 * * * * export $(cat /home/<your_username>/code-indexer/.env | xargs) && /usr/bin/npm --prefix /home/<your_username>/code-indexer run incremental-index -- .repos/<your_repo_name> >> /home/<your_username>/code-indexer/cron.log 2>&1
    ```
    *This command sources the `.env` file, runs the command, and redirects all output and errors to a `cron.log` file.*

3.  **Save and exit** the editor. The cron job is now active.

## 4. Monitoring

-   **Systemd**: Use `journalctl -u incremental-indexer.service -f` to follow the structured JSON logs in real-time. You can use tools like `jq` to parse and filter the logs.
-   **Cron**: Monitor the `cron.log` file for output: `tail -f ~/code-indexer/cron.log`.
-   **GCP Logging**: Configure the [Ops Agent](https://cloud.google.com/monitoring/agent/ops-agent) on your VM to stream the log files to Google Cloud Logging for a centralized, searchable view.
-   **VM Health**: Monitor CPU, disk, and memory utilization for your Compute Engine instance in the GCP Console under **Compute Engine > VM instances > Monitoring**.