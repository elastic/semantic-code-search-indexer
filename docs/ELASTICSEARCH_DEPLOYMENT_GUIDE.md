# Elasticsearch Deployment Guide

This guide provides step-by-step instructions for setting up the necessary machine learning models and ingest pipelines in your Elasticsearch cluster to support the Semantic Code Indexer.

This setup enables two powerful features:
1.  **Semantic Search:** Using Elastic's ELSER model for sparse vector text expansion.
2.  **Code Similarity Search:** Using Microsoft's CodeBERT model to generate dense vectors for future KNN (k-Nearest Neighbor) features, such as a `find_similar_code` tool.

---

## Prerequisites

- An Elasticsearch cluster (v8.0 or later).
- Access to the Kibana Dev Tools console.
- Python and `pip` installed on your local machine.
- The `eland` Python library installed (`pip install eland`).

---

### Step 1: Deploy the ELSER Model

ELSER (Elastic Learned Sparse EncodeR) is a sparse vector model that powers our primary semantic search functionality.

1.  Navigate to the **Dev Tools** console in your Kibana instance.
2.  Run the following command to download and deploy the ELSER model. We are using version 2.

```json
PUT _ml/trained_models/.elser_model_2
{
  "input": {
    "field_names": ["text_field"]
  }
}
```

3.  The model will begin downloading and deploying. You can monitor its status in the **Machine Learning > Trained Models** section of Kibana. Ensure the model deployment is "Started" before proceeding.

---

### Step 2: Deploy the Dense Vector Model (CodeBERT)

For the planned `find_similar_code` feature, we need a dense vector model that is specifically trained on source code. We will use `microsoft/codebert-base` from the Hugging Face Hub.

1.  **Install Eland:** If you haven't already, install the `eland` client.
    ```bash
    pip install eland
    ```

2.  **Troubleshooting: Upgrade PyTorch:** The `eland` tool depends on PyTorch. Due to a recent security vulnerability, you may need to upgrade `torch` to version 2.6 or higher. If you encounter an error during the model import, run this command first:
    ```bash
    pip install --upgrade torch
    ```

3.  **Import the Model:** Run the following command in your terminal. Replace the environment variables with your actual Elasticsearch credentials. This command will download the CodeBERT model, convert it to a TorchScript representation, and upload it to your cluster.

    ```bash
    eland_import_hub_model \
      --cloud-id $ELASTICSEARCH_CLOUD_ID \
      --hub-model-id microsoft/codebert-base \
      --task-type text_embedding \
      --es-api-key $ELASTICSEARCH_API_KEY \
      --start
    ```
    This process will create a new model in Elasticsearch with the ID `microsoft__codebert-base`.

---

### Step 3: Create the Optimized Ingest Pipeline

This ingest pipeline will **selectively** use the CodeBERT model to generate dense vector embeddings for the most valuable code chunks, saving significant computational resources.

1.  Navigate to the **Dev Tools** console in Kibana.
2.  Run the following command to create the pipeline:

```json
PUT _ingest/pipeline/code-similarity-pipeline
{
  "description": "Pipeline to selectively generate dense vector embeddings for substantive code chunks.",
  "processors": [
    {
      "grok": {
        "field": "kind",
        "patterns": ["^(call_expression|import_statement|lexical_declaration)$"],
        "on_failure": [
          {
            "inference": {
              "model_id": "microsoft__codebert-base",
              "target_field": "code_vector",
              "field_map": {
                "content": "text_field"
              }
            }
          },
          {
            "set": {
              "field": "code_vector",
              "copy_from": "code_vector.predicted_value"
            }
          }
        ]
      }
    }
  ]
}
```
This pipeline intelligently inspects the `kind` of each code chunk. If it's a low-value type (like a function call or import), it skips the expensive embedding process. For high-value chunks (like functions and classes), it generates the dense vector and stores it in the `code_vector` field.

---

## Summary

After completing these steps, your Elasticsearch cluster is fully configured. You have:
- The **.elser_model_2** deployed for sparse vector semantic search.
- The **microsoft__codebert-base** model deployed for dense vector code similarity.
- The optimized **code-similarity-pipeline** ready to selectively and automatically generate dense vectors during indexing.

The application will automatically create the index with the correct mapping on its first run.

### Automatic Alias Creation

The indexer automatically creates a `-repo` alias for each index to enable automatic discovery by the MCP server. For example, if you index with the name `kibana`, the indexer will:

1. Create the index: `kibana`
2. Automatically create an alias: `kibana-repo` pointing to `kibana`

This allows the MCP server to automatically discover indices without requiring manual alias creation. The alias creation is idempotent and backward compatible - it will create aliases for existing indices as well as new ones.

**Index Name Normalization:** The indexer automatically normalizes index names by removing all trailing `-repo` segments. This ensures alias creation always works, since Elasticsearch does not allow an alias to have the same name as an index:
- `kibana-repo-repo-repo` → normalized to `kibana` (index name)
- `my-repo-repo` → normalized to `my` (index name)
- `kibana-repo` → normalized to `kibana` (index name)
- `kibana` → stays `kibana` (no normalization needed)

A warning is logged when normalization occurs: `"Index name 'X' was normalized to 'Y' (removed duplicate -repo segments)"`

**Alias Creation:** After index name normalization, creates an alias by appending `-repo` to the normalized index name:
- Index `kibana` → creates alias `kibana-repo`
- Index `kibana-repo` (normalized to `kibana`) → creates alias `kibana-repo` pointing to `kibana` index
- Index `kibana-repo-repo-repo` (normalized to `kibana`) → creates alias `kibana-repo` pointing to `kibana` index

This ensures that even if users accidentally specify index names with multiple `-repo` segments, both the index name and alias will be clean and consistent.

**Conflict Detection:** If an index with the alias name already exists (e.g., you have both `kibana` and `kibana-repo` as separate indices), the alias creation is automatically skipped with a clear warning message. This prevents errors and ensures indexing continues normally. The existing index remains untouched, and the MCP server will discover both indices separately.

```