#!/bin/bash

# Go to the project directory
cd /opt/semantic-code-search-indexer || exit

# Source environment variables (bash-specific command)
if [ -f .env ]; then
  source .env
fi

# Run the command using the full path to npm for reliability
/usr/bin/npm run bulk:incremental-index -- $REPOSITORIES_TO_INDEX
