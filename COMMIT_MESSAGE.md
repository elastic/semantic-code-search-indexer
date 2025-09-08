Refactor GCP deployment to simplify worker logic

- Removes the persistent, watch-based `indexer-worker@.service`.
- Deletes the specialized `multi-index-worker` command and its associated files.
- Consolidates the producer and worker logic into a single, sequential process within the `run_multi_producer.sh` script.
- The producer script now directly invokes the generic `index-worker` for each repository after enqueuing changes.
- Updates the `GCP_DEPLOYMENT_GUIDE.md` to reflect the simpler, non-persistent architecture.
- Adds a `TimeoutStartSec=0` recommendation to the `indexer-producer.service` to handle long-running jobs.

Prompts:

- "Can you review the GCP_DEPLOYMENT_GUIDE.md along with the different scripts that are called. I feel like when I read the `index-worker@.service` I think that the multi-index-worker will still need to be called with `ELASTICSEARCH_INDEX` to ensure it indexes to the correct Elasticsearch index for the repository."
- "I feel like we could simplify this even more... why not run `npm run index-worker` immediately after the incremental-index command? It doesn't need to be running continuously. Just after incremental-index runs."
- "Why not just use index-worker and add QUEUE_DIR and ELASTICSEARCH_INDEX to the command. Then we have less code."

🤖 This commit was assisted by Gemini CLI
