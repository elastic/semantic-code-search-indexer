#!/bin/bash
set -e

# Check for Docker Compose v2
if ! docker compose version &> /dev/null; then
  echo "ERROR: Docker Compose v2 not found."
  echo "Please install Docker Desktop (Mac/Windows) or Docker Engine with Compose plugin (Linux)."
  exit 1
fi

echo "Stopping Elasticsearch integration test environment..."
docker compose -f docker-compose.integration.yml down -v

echo "✅ Integration test environment cleaned up!"
