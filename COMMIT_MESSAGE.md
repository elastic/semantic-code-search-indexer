Switch to cron for deployment to fix ENOENT

- Replaces the `systemd` service with a `cron` job to resolve a persistent `ENOENT` error caused by `systemd` sandboxing.
- Updates the `GCP_DEPLOYMENT_GUIDE.md` with instructions for setting up the `cron` job.
- Fixes a bug in the producer's error logging to ensure error objects are logged as strings.

Prompts:

- "What if we changed to just a simple cron?"

🤖 This commit was assisted by Gemini CLI
