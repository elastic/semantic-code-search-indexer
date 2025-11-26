#!/bin/bash
set -e

# Check for Docker Compose v2
if ! docker compose version &> /dev/null; then
  echo "ERROR: Docker Compose v2 not found."
  echo "Please install Docker Desktop (Mac/Windows) or Docker Engine with Compose plugin (Linux)."
  echo "See: https://docs.docker.com/compose/install/"
  exit 1
fi

echo "Starting Elasticsearch for integration tests..."
docker compose -f docker-compose.integration.yml up -d

echo "Waiting for Elasticsearch to be ready..."
timeout=180
elapsed=0
while ! curl -s -u elastic:testpassword http://localhost:9200/_cluster/health >/dev/null; do
  if [ $elapsed -ge $timeout ]; then
    echo "ERROR: Elasticsearch did not start within $timeout seconds"
    docker compose -f docker-compose.integration.yml logs
    exit 1
  fi
  echo "Waiting for Elasticsearch... ($elapsed/$timeout seconds)"
  sleep 5
  elapsed=$((elapsed + 5))
done

echo "Elasticsearch is ready!"

echo "Setting up ELSER inference endpoint for ES 9.x..."
# Check if inference endpoint already exists
INFERENCE_EXISTS=$(curl -s -u elastic:testpassword http://localhost:9200/_inference/elser-inference-test 2>&1 | grep -o '"inference_id"' || echo "not_found")

if [[ "$INFERENCE_EXISTS" == *"inference_id"* ]]; then
  echo "ELSER inference endpoint already exists"
else
  echo "Creating ELSER inference endpoint (this may take a few minutes)..."
  
  # Create inference endpoint using the built-in elser service in ES 9.x
  curl -s -X PUT -u elastic:testpassword \
    "http://localhost:9200/_inference/sparse_embedding/elser-inference-test" \
    -H "Content-Type: application/json" \
    -d '{
      "service": "elser",
      "service_settings": {
        "num_allocations": 1,
        "num_threads": 1
      }
    }' >/dev/null
  
  echo "ELSER inference endpoint created successfully!"
fi

echo ""
echo "✅ Integration test environment is ready!"
echo "   Elasticsearch: http://localhost:9200"
echo "   Username: elastic"
echo "   Password: testpassword"
echo ""
echo "Run tests with: npm run test:integration"
