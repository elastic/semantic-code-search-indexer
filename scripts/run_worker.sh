#!/bin/bash

# This script starts the standalone indexer worker in a persistent,
# detached tmux session.

SESSION_NAME="indexer_worker"
ENV_FILE=".env" # Assumes a single .env file for the standalone worker

# Load environment variables if the file exists
if [ -f "$ENV_FILE" ]; then
  echo "--- Loading environment variables from ${ENV_FILE} ---"
  set -o allexport
  source "$ENV_FILE"
  set +o allexport
fi

# Check if the tmux session already exists
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "A tmux session named '${SESSION_NAME}' is already running."
  echo "To attach to it, run: tmux attach-session -t ${SESSION_NAME}"
  echo "To kill it, run: tmux kill-session -t ${SESSION_NAME}"
  exit 1
fi

echo "--- Starting new tmux session '${SESSION_NAME}' for the worker ---"
tmux new-session -d -s "$SESSION_NAME" "npm run index-worker -- --watch --concurrency=4"

echo "--- Worker started successfully in a detached tmux session. ---"
echo "To monitor the worker, attach to the session with the command:"
echo "tmux attach-session -t ${SESSION_NAME}"
