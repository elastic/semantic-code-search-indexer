# Buildkite Review Command - Usage Examples

This document provides practical examples of using the `buildkite:review` command to analyze and fix build failures.

## Prerequisites

Before using the command, ensure you have:

1. A Buildkite API token with appropriate permissions
2. Your organization and pipeline slugs
3. Environment variables configured in `.env`:

```bash
BUILDKITE_TOKEN=bkua_your_token_here
BUILDKITE_ORG=elastic
BUILDKITE_PIPELINE=semantic-code-search-indexer
```

## Example Scenarios

### Scenario 1: Quick Check for Recent Failures

**Use Case:** You want to quickly see if there are any recent build failures.

```bash
npm run buildkite:review
```

**Expected Output:**
```
📊 Found 3 recent failed build(s):

================================================================================

Build #456 - Fix linting errors
Branch: feature/lint-fix
Failed Jobs: 2
URL: https://buildkite.com/elastic/semantic-code-search-indexer/builds/456
--------------------------------------------------------------------------------

Build #455 - Update dependencies
Branch: main
Failed Jobs: 1
URL: https://buildkite.com/elastic/semantic-code-search-indexer/builds/455
--------------------------------------------------------------------------------

Build #454 - Add new feature
Branch: feature/new-feature
Failed Jobs: 1
URL: https://buildkite.com/elastic/semantic-code-search-indexer/builds/454
--------------------------------------------------------------------------------

💡 To see detailed analysis of a specific build, run:
   npm run buildkite:review -- --build <number>
```

### Scenario 2: Analyzing a Specific Failed Build

**Use Case:** Build #456 failed and you need to understand why.

```bash
npm run buildkite:review -- --build 456
```

**Expected Output:**
```
================================================================================
Build #456: Fix linting errors
Branch: feature/lint-fix
URL: https://buildkite.com/elastic/semantic-code-search-indexer/builds/456
================================================================================

❌ Found 2 failed job(s):

📋 Job: Lint
   Exit Status: 1
   URL: https://buildkite.com/elastic/semantic-code-search-indexer/builds/456#job-abc123

   Error Summary:
   ----------------------------------------------------------------------------
   /home/runner/work/project/src/utils/buildkite.ts
     18:10  error  'logger' is defined but never used  @typescript-eslint/no-unused-vars
   /home/runner/work/project/src/commands/list_failed.ts
     55:18  error  'parseError' is defined but never used  @typescript-eslint/no-unused-vars
   ✖ 2 problems (2 errors, 0 warnings)
   ----------------------------------------------------------------------------

📋 Job: Build
   Exit Status: 2
   URL: https://buildkite.com/elastic/semantic-code-search-indexer/builds/456#job-def456

   Error Summary:
   ----------------------------------------------------------------------------
   error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
   error TS2322: Type 'number' is not assignable to type 'string'.
   ----------------------------------------------------------------------------

💡 Suggested Actions:

1. Review the error logs above to identify the root cause
2. Check if the failure is related to:
   - Dependency issues (run: npm install or update dependencies)
   - Linting errors (run: npm run lint)
   - Test failures (run: npm test)
   - Build errors (run: npm run build)
3. Fix the identified issues locally and push changes
4. Monitor the next build to verify the fix

⚠️  Detected linting issues - Consider:
   - Running: npm run lint -- --fix
   - Reviewing ESLint configuration

⚠️  Detected TypeScript issues - Consider:
   - Running: npm run build
   - Checking type definitions and imports
```

**Action to Take:**
```bash
# Fix linting issues
npm run lint -- --fix

# Fix TypeScript errors by reviewing the code
npm run build

# After fixing, commit and push
git add .
git commit -m "Fix linting and TypeScript errors from build #456"
git push
```

### Scenario 3: Monitoring Failures on Main Branch

**Use Case:** You want to ensure the main branch is healthy.

```bash
npm run buildkite:review -- --branch main --limit 10
```

**Expected Output:**
```
📊 Found 1 recent failed build(s):

================================================================================

Build #455 - Update dependencies
Branch: main
Failed Jobs: 1
URL: https://buildkite.com/elastic/semantic-code-search-indexer/builds/455
--------------------------------------------------------------------------------

💡 To see detailed analysis of a specific build, run:
   npm run buildkite:review -- --build <number>
```

### Scenario 4: Investigating npm/Dependency Issues

**Use Case:** Build failed due to dependency installation problems.

```bash
npm run buildkite:review -- --build 455
```

**Expected Output:**
```
================================================================================
Build #455: Update dependencies
Branch: main
URL: https://buildkite.com/elastic/semantic-code-search-indexer/builds/455
================================================================================

❌ Found 1 failed job(s):

📋 Job: Install Dependencies
   Exit Status: 1
   URL: https://buildkite.com/elastic/semantic-code-search-indexer/builds/455#job-xyz789

   Error Summary:
   ----------------------------------------------------------------------------
   npm ERR! code ERESOLVE
   npm ERR! ERESOLVE could not resolve
   npm ERR! While resolving: semantic-code-search-indexer@1.0.0
   npm ERR! Found: eslint@9.33.0
   npm ERR! Could not resolve dependency:
   npm ERR! peer eslint@"^8.0.0" from @typescript-eslint/parser@8.39.1
   ----------------------------------------------------------------------------

💡 Suggested Actions:

1. Review the error logs above to identify the root cause
2. Check if the failure is related to:
   - Dependency issues (run: npm install or update dependencies)
   - Linting errors (run: npm run lint)
   - Test failures (run: npm test)
   - Build errors (run: npm run build)
3. Fix the identified issues locally and push changes
4. Monitor the next build to verify the fix

⚠️  Detected npm/package issues - Consider:
   - Running: npm ci (clean install)
   - Checking package-lock.json for conflicts
   - Verifying Node.js version compatibility
```

**Action to Take:**
```bash
# Fix dependency conflicts
npm install eslint@^8.0.0
# or update the peer dependency
npm install @typescript-eslint/parser@latest

# Verify the fix works locally
npm ci
npm run build
npm test

# Commit and push
git add package*.json
git commit -m "Fix dependency conflicts - update eslint version"
git push
```

### Scenario 5: Using CLI Options Instead of Environment Variables

**Use Case:** You want to check a different pipeline without changing your `.env` file.

```bash
npm run buildkite:review -- \
  --token "bkua_your_token" \
  --org "elastic" \
  --pipeline "kibana" \
  --branch "main" \
  --limit 5
```

## Workflow Integration

### Daily Build Health Check

Create a shell script for daily monitoring:

```bash
#!/bin/bash
# check-builds.sh

echo "Checking recent build failures..."
npm run buildkite:review -- --limit 10

echo ""
echo "Checking main branch health..."
npm run buildkite:review -- --branch main --limit 5
```

Run it daily:
```bash
chmod +x check-builds.sh
./check-builds.sh
```

### Post-Failure Investigation

When you receive a build failure notification:

1. **Get the build number** from the notification email/Slack
2. **Run the review command:**
   ```bash
   npm run buildkite:review -- --build <build-number>
   ```
3. **Follow the suggested actions** to fix the issues
4. **Verify locally** before pushing
5. **Monitor the next build** to confirm the fix

### Pre-Push Validation

Before pushing to main, check if there are any recent failures:

```bash
# Check for recent main branch failures
npm run buildkite:review -- --branch main --limit 1

# If no failures, proceed with push
git push origin main
```

## Troubleshooting Common Issues

### Issue: "401 Unauthorized"

**Solution:**
```bash
# Verify your token is correct
echo $BUILDKITE_TOKEN

# Or use the CLI option
npm run buildkite:review -- --token "your-new-token" --org elastic --pipeline your-pipeline
```

### Issue: "404 Not Found"

**Solution:**
```bash
# Verify org and pipeline slugs
# Visit: https://buildkite.com/{org}/{pipeline}
# Use the slugs from the URL

npm run buildkite:review -- --org correct-org --pipeline correct-pipeline
```

### Issue: No output or empty results

**Solution:**
```bash
# Check if there are failed builds in the specified time range
npm run buildkite:review -- --limit 20

# Try a different branch
npm run buildkite:review -- --branch develop
```

## Advanced Usage

### Scripting and Automation

You can use the command in CI/CD scripts or automated workflows:

```bash
#!/bin/bash
# auto-check-and-notify.sh

RESULT=$(npm run buildkite:review -- --branch main --limit 1 2>&1)

if echo "$RESULT" | grep -q "No recent failed builds"; then
    echo "✅ All builds passing on main"
    exit 0
else
    echo "❌ Build failures detected on main"
    echo "$RESULT"
    # Send notification (e.g., Slack, email)
    # curl -X POST -H 'Content-type: application/json' \
    #   --data "{\"text\":\"Build failure on main: $RESULT\"}" \
    #   $SLACK_WEBHOOK_URL
    exit 1
fi
```

### Integration with Git Hooks

Add to `.git/hooks/pre-push`:

```bash
#!/bin/bash
# pre-push hook to check build status before pushing

BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ "$BRANCH" = "main" ]; then
    echo "Checking recent build status on main..."
    npm run buildkite:review -- --branch main --limit 1
    
    read -p "Continue with push? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi
```

## Summary

The `buildkite:review` command provides:
- 🔍 Quick visibility into build failures
- 📊 Detailed error analysis with context
- 💡 Actionable suggestions for fixes
- 🛠️ Integration points for automation

Use it regularly to maintain build health and quickly resolve issues when they occur.
