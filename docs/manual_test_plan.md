# Manual Test Plan

This document provides instructions for manually testing the end-to-end functionality of the resilient indexing system in both `standalone` and `gcp` modes.

## Part 1: Standalone Mode Verification

This test verifies the complete indexing flow using the local SQLite queue.

### Prerequisites

- A local Elasticsearch instance running and accessible.
- A git repository cloned locally to use as a data source (e.g., `.repos/semantic-code-search-mcp-server`).

### Test Steps

1.  **Clean Environment:**
    - Delete the queue directory to ensure a fresh start:
      ```bash
      rm -rf .queue
      ```
    - Run the indexer with the `--clean` flag to delete the Elasticsearch index:
      ```bash
      npm run index -- .repos/semantic-code-search-mcp-server --clean
      ```
    - **Expected Result:** The command should complete, logging that it scanned files, enqueued chunks to the SQLite queue, processed them, and indexed them to Elasticsearch. The queue should be empty when finished.

2.  **Verify Data in Elasticsearch:**
    - Use a tool like Kibana Dev Tools or `curl` to query the Elasticsearch index and confirm that documents have been indexed.
      ```bash
      curl -u elastic:changeme "http://localhost:9200/code-chunks/_count"
      ```
    - **Expected Result:** The count should be greater than zero.

### Failure Simulation (Standalone)

1.  **Reset the Test:**
    - Delete the queue directory and Elasticsearch index:
      ```bash
      rm -rf .queue
      npm run index -- .repos/semantic-code-search-mcp-server --clean
      ```
    - This ensures a clean starting state for the failure test.

2.  **Stop Elasticsearch:**
    - If you are running Elasticsearch in Docker, stop the container:
      ```bash
      docker stop <your-es-container-name>
      ```

3.  **Run the Indexer:**
    - Start the indexer:
      ```bash
      npm run index -- .repos/semantic-code-search-mcp-server
      ```
    - **Expected Result:** The indexer will scan files and enqueue chunks. When the worker attempts to index them, it will log errors indicating it cannot connect to Elasticsearch. Failed batches will be requeued with incremented retry counts in the SQLite queue.

4.  **Verify Requeue:**
    - Check the queue status:
      ```bash
      npm run queue:monitor
      ```
    - **Expected Result:** You should see documents in the queue with `failed` or `pending` status and non-zero retry counts.

5.  **Restart Elasticsearch and Verify Recovery:**
    - Restart the Elasticsearch container.
    - Run the indexer again to process the failed items:
      ```bash
      npm run index -- .repos/semantic-code-search-mcp-server
      ```
    - **Expected Result:** The indexer should successfully process the retried batches and empty the queue. Verify with `npm run queue:monitor` that the queue is empty, and query Elasticsearch to confirm the data was indexed.

## Part 2: GCP Mode Verification

This test verifies the flow using Google Cloud Pub/Sub and a deployed Cloud Function.

### Prerequisites

- All steps in `docs/gcp_deployment_guide.md` have been completed.
- The Cloud Function has been successfully deployed.

### Test Steps

1.  **Configure for GCP:**
    - Ensure your `.env` file has `APP_MODE="gcp"` and all GCP/Elasticsearch variables are set correctly.

2.  **Run the Indexer:**
    - Run the indexer to send messages to the Pub/Sub topic:
      ```bash
      npm run index -- .repos/semantic-code-search-mcp-server --clean
      ```
    - **Expected Result:** The command should complete successfully, logging that it has enqueued documents to Pub/Sub.

3.  **Verify Pub/Sub Messages:**
    - Check the message count in your Pub/Sub subscription in the GCP Console or via `gcloud`:
      ```bash
      gcloud pubsub subscriptions pull ${PUB_SUB_SUBSCRIPTION_ID} --auto-ack --limit=10
      ```
    - **Expected Result:** You should see messages being pulled from the subscription.

4.  **Monitor Cloud Function:**
    - Go to the Cloud Functions section of the GCP Console and view the logs for your `semantic-code-indexer` function.
    - **Expected Result:** You should see logs indicating that the function is being triggered, processing documents, and successfully indexing them.

5.  **Verify Data and Empty Queue:**
    - After some time, the number of unacknowledged messages in the Pub/Sub subscription should drop to zero.
    - Query Elasticsearch to confirm the data has been indexed.
    - **Expected Result:** The queue is empty and the data is in Elasticsearch.

### Failure Simulation (GCP)

1.  **Reset the Test:**
    - Purge the Pub/Sub topic if necessary and re-run the indexer (Step 2 above).

2.  **Simulate Failure:**
    - Go to the Cloud Function's configuration in the GCP Console.
    - Edit the function and remove or invalidate one of the environment variables (e.g., `ELASTICSEARCH_API_KEY`). Redeploy the function.
    - This will cause the function to fail when it tries to connect to Elasticsearch.

3.  **Observe Failures and Redelivery:**
    - Monitor the Cloud Function's logs.
    - **Expected Result:** You will see logs indicating failures. In the Pub/Sub console, you will see the "Unacknowledged messages" count remain high, as Pub/Sub attempts to redeliver the failing messages.

4.  **Verify Dead-Letter Queue:**
    - After the configured `max-delivery-attempts` (e.g., 5), the messages should be moved to the dead-letter queue.
    - Check the DLQ's subscription for messages:
      ```bash
      gcloud pubsub subscriptions pull ${PUB_SUB_SUBSCRIPTION_ID}-dlq-sub --auto-ack --limit=10
      ```
    - **Expected Result:** The failed messages should now be visible in the DLQ.

5.  **Fix and Recover:**
    - Correct the environment variable in the Cloud Function and redeploy it.
    - You can now manually move messages from the DLQ back to the main topic to be reprocessed successfully (this is an advanced recovery step).
