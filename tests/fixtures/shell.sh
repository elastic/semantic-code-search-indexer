#!/bin/bash
# Deployment script for production

set -e

echo "Starting deployment..."
npm run build
docker build -t myapp .
docker push myapp:latest
echo "Deployment complete!"
