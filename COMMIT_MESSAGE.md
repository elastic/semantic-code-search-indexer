Revert to execSync for git commands

- Reverts the git command execution in `incremental_index_command.ts` from `spawnSync` back to `execSync`.
- This is a troubleshooting step to address a persistent `ENOENT` error in a specific remote environment.

Prompts:

- "can we go back to the original git command that worked"

🤖 This commit was assisted by Gemini CLI
