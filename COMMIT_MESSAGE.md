Fix ENOENT error by using spawnSync for git commands

- Refactors the `incremental-index` command to use `spawnSync` instead of `execSync` for all git operations.
- This change avoids shell parsing issues and correctly handles paths with spaces, resolving the `ENOENT` error when the `GIT_PATH` environment variable is used.
- A `runGitCommand` helper function has been introduced to centralize the logic for executing git commands.

Prompts:

- "I'm getting this error: ... spawnSync /bin/sh ENOENT"

🤖 This commit was assisted by Gemini CLI
