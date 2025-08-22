# GCP Webhook Deployment Guide (VM Worker)

This guide provides step-by-step instructions for deploying a persistent worker on a GCP Compute Engine VM, which is the recommended architecture for indexing large repositories.

## Architecture Overview

-   **Webhook Server (Cloud Run)**: A lightweight, serverless function that receives webhook events from GitHub, verifies them, and immediately publishes them to a Pub/Sub topic.
-   **Message Queue (Pub/Sub)**: A reliable, scalable message bus that decouples the webhook receiver from the worker.
-   **Persistent Worker (Compute Engine VM)**: An "always-on" virtual machine that stores the large git repository, listens for messages from Pub/Sub, and runs the incremental indexing command.

## Prerequisites

-   A GCP account with billing enabled.
-   The `gcloud` CLI installed and authenticated.
-   A GitHub repository you want to index.
-   An Elasticsearch instance accessible from your GCP project.

## 1. GCP Project Setup

1.  **Enable the required APIs**:
    ```bash
    gcloud services enable run.googleapis.com
    gcloud services enable cloudbuild.googleapis.com
    gcloud services enable pubsub.googleapis.com
    gcloud services enable secretmanager.googleapis.com
    gcloud services enable logging.googleapis.com
    gcloud services enable compute.googleapis.com
    gcloud services enable artifactregistry.googleapis.com # New API
    ```

## 2. Security: Create a Webhook Secret

1.  **Generate a strong secret** for your GitHub webhook.
2.  **Store it in Secret Manager**:
    ```bash
    export GITHUB_WEBHOOK_SECRET="your-strong-secret"
    echo -n $GITHUB_WEBHOOK_SECRET | gcloud secrets create github-webhook-secret --data-file=-
    ```

## 3. Deploy the Webhook Server to Cloud Run

This process is updated to use Artifact Registry instead of the deprecated Container Registry.

1.  **Create an Artifact Registry Repository**:
    This is a one-time setup to create a place to store your Docker images.
    ```bash
    export AR_REPO="code-indexer-repo"
    export GCP_REGION="us-central1"
    gcloud artifacts repositories create $AR_REPO \
        --repository-format=docker \
        --location=$GCP_REGION \
        --description="Docker repository for code-indexer"
    ```

2.  **Build the Docker image and submit it to Artifact Registry**:
    ```bash
    export GCP_PROJECT_ID=$(gcloud config get-value project)
    export IMAGE_NAME="code-indexer-webhook"
    export IMAGE_TAG="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${AR_REPO}/${IMAGE_NAME}"

    gcloud builds submit --tag $IMAGE_TAG
    ```

3.  **Create the Pub/Sub topic**:
    ```bash
    export GCP_PUBSUB_TOPIC="github-pushes"
    gcloud pubsub topics create $GCP_PUBSUB_TOPIC
    ```
4.  **Deploy to Cloud Run**:
    Note that the `--image` flag now points to the new Artifact Registry path.
    ```bash
    gcloud run deploy code-indexer-webhook \
      --image $IMAGE_TAG \
      --platform managed \
      --region $GCP_REGION \
      --allow-unauthenticated \
      --set-env-vars="GCP_PUBSUB_TOPIC=$GCP_PUBSUB_TOPIC" \
      --set-secrets="GITHUB_WEBHOOK_SECRET=github-webhook-secret:latest"
    ```
5.  **Note the service URL** from the output. This is your webhook payload URL.

## 4. Deploy the Persistent Worker to a Compute Engine VM

This is the core of the new architecture.

1.  **Create a VM Instance**:
    Choose a machine type appropriate for your workload. An `e2-medium` is a good starting point.
    ```bash
    gcloud compute instances create persistent-indexer-worker \
        --project=$GCP_PROJECT_ID \
        --zone=us-central1-a \
        --machine-type=e2-medium \
        --boot-disk-size=100GB \
        --scopes=https://www.googleapis.com/auth/cloud-platform \
        --image-family=ubuntu-2204-lts \
        --image-project=ubuntu-os-cloud
    ```
    *The `--scopes` flag grants the VM access to other GCP services, including Pub/Sub.*

2.  **SSH into the VM**:
    ```bash
    gcloud compute ssh persistent-indexer-worker --zone=us-central1-a
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
    This is the one-time setup for your large repository (e.g., Kibana).
    ```bash
    # Set your Elasticsearch URL
    export ELASTICSEARCH_URL="http://your-elasticsearch-instance:9200"

    # Run the setup command for the target repo
    npm run setup -- <your-large-repo-url>

    # Run the initial full index
    # This will take a long time for a large repo
    npm run index -- .repos/<your-large-repo-name>
    ```

6.  **Configure and Run the Worker as a Service (using `systemd`)**:
    This ensures the worker runs continuously and restarts on failure or reboot.

    -   **Create a `.env` file** in the `code-indexer` directory on the VM to hold your environment variables. Use the Cloud ID and API Key for Elastic Cloud.
        ```ini
        # /home/user/code-indexer/.env
        # --- Elasticsearch Configuration ---
        # Use ELASTICSEARCH_CLOUD_ID for Elastic Cloud (recommended)
        ELASTICSEARCH_CLOUD_ID=<your-cloud-id>
        ELASTICSEARCH_API_KEY=<your-base64-encoded-api-key>

        # Or, for a self-managed instance, use ELASTICSEARCH_ENDPOINT
        # ELASTICSEARCH_ENDPOINT=http://your-elasticsearch-instance:9200

        # --- Pub/Sub Configuration ---
        GCP_PUBSUB_TOPIC=github-pushes
        GCP_PUBSUB_SUBSCRIPTION=github-pushes-sub-vm
        ```

    -   **Create a `systemd` service file**:
        ```bash
        sudo nano /etc/systemd/system/indexer-worker.service
        ```
        Paste the following content into the file. **Make sure to replace `<your_username>` and `<your_project_directory>`**.
        ```ini
        [Unit]
        Description=Code Indexer Persistent Worker
        After=network.target

        [Service]
        Type=simple
        User=<your_username>
        WorkingDirectory=/home/<your_username>/<your_project_directory>
        EnvironmentFile=/home/<your_username>/<your_project_directory>/.env
        ExecStart=/usr/bin/npm run start:vm-worker
        Restart=on-failure

        [Install]
        WantedBy=multi-user.target
        ```

    -   **Enable and start the service**:
        ```bash
        sudo systemctl daemon-reload
        sudo systemctl enable indexer-worker.service
        sudo systemctl start indexer-worker.service
        ```

    -   **Check the status of your service**:
        ```bash
        sudo systemctl status indexer-worker.service
        journalctl -u indexer-worker.service -f # To follow the logs
        ```

## 5. Configure the GitHub Webhook

This is the same as before. Use the Cloud Run URL from Step 3 as the Payload URL.

## 6. Monitoring

-   **Webhook Server**: View logs in the GCP Console under **Cloud Run**.
-   **Persistent Worker**: View logs on the VM itself using `journalctl -u indexer-worker.service -f` or configure the [Ops Agent](https://cloud.google.com/monitoring/agent/ops-agent) on your VM to stream logs to Cloud Logging for a centralized view.
-   **VM Health**: Monitor CPU, disk, and memory utilization for your Compute Engine instance in the GCP Console under **Compute Engine > VM instances > Monitoring**.

This revised architecture provides a robust and efficient solution for indexing large repositories.
