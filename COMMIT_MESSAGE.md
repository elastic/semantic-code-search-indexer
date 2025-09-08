Refactor producer to TypeScript to fix systemd ENOENT

- Resolves a persistent `ENOENT` error by refactoring the producer logic from a shell script (`run_multi_producer.sh`) into a pure TypeScript entrypoint (`src/run_producer.ts`).
- This avoids the complex and problematic interactions between `systemd` sandboxing and the layers of `sh`, `npm`, and `ts-node`.
- Creates a new `start:producer` npm script to execute the compiled TypeScript entrypoint.
- Updates the `GCP_DEPLOYMENT_GUIDE.md` to use the new `npm run start:producer` command in the `systemd` service file.
- Deletes the now-obsolete `run_multi_producer.sh` script.

Prompts:

- "I'm getting this error now: ... spawnSync /usr/bin/git ENOENT"
- "same error"
- "Here is the output: ... /usr/bin/git is visible and executable."

🤖 This commit was assisted by Gemini CLI
