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

```