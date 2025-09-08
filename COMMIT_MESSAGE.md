Refactor producer to a standard commander command

- Refactors the producer logic from a standalone script (`src/run_producer.ts`) into a standard `commander` command (`src/commands/run_producer_command.ts`).
- This aligns the producer with the existing command structure, improving consistency and maintainability.
- The `start:producer` npm script is updated to call the new `run-producer` command.
- The `GCP_DEPLOYMENT_GUIDE.md` is updated to reflect the new command.
- The `spawnSync` implementation for git commands is restored as it is the more robust solution.

Prompts:

- "can we go back to the original git command that worked"
- "`npm run incremental-index` runs without errors... how can we make it work exactly the same... look at the package json"
- "Can you please make run producer work like the rest of the commands..."

🤖 This commit was assisted by Gemini CLI
