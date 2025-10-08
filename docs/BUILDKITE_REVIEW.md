# Buildkite Build Failure Review

This feature allows you to review and analyze build failures from Buildkite CI/CD pipelines directly from the command line. It fetches failed builds, analyzes the error logs, and provides actionable suggestions for fixing the issues.

## Setup

### 1. Get a Buildkite API Token

1. Log in to your Buildkite account
2. Go to **Personal Settings** → **API Access Tokens**
3. Click **New API Access Token**
4. Give it a descriptive name (e.g., "Build Failure Reviewer")
5. Grant the following scopes:
   - `read_builds` - To read build information
   - `read_build_logs` - To read job logs
6. Copy the generated token

### 2. Configure Environment Variables

Add the following to your `.env` file:

```bash
BUILDKITE_TOKEN=your_api_token_here
BUILDKITE_ORG=your-organization-slug
BUILDKITE_PIPELINE=your-pipeline-slug
```

**Finding your organization and pipeline slugs:**
- Your Buildkite URL looks like: `https://buildkite.com/{org}/{pipeline}`
- The organization slug is the first part after `buildkite.com/`
- The pipeline slug is the second part

Example:
- URL: `https://buildkite.com/elastic/semantic-code-search-indexer`
- Organization: `elastic`
- Pipeline: `semantic-code-search-indexer`

## Usage

### Review Recent Failed Builds

To see a summary of recent failed builds:

```bash
npm run buildkite:review
```

This will display:
- Build numbers
- Commit messages
- Branches
- Number of failed jobs per build
- Direct links to the builds

You can customize the number of builds to review:

```bash
npm run buildkite:review -- --limit 10
```

### Review Builds for a Specific Branch

```bash
npm run buildkite:review -- --branch main
npm run buildkite:review -- --branch feature/my-feature
```

### Analyze a Specific Build

To get detailed analysis of a specific build:

```bash
npm run buildkite:review -- --build 123
```

This will show:
- Build metadata (number, branch, commit message)
- List of all failed jobs
- Exit status for each failed job
- Error summary extracted from logs
- Suggested fixes based on error patterns

### Using Command-Line Options

You can override environment variables with command-line options:

```bash
npm run buildkite:review -- \
  --token your_token \
  --org your-org \
  --pipeline your-pipeline \
  --build 123
```

## Features

### Automatic Error Detection

The tool automatically detects common error patterns:

- **npm/package issues** - Dependency installation failures
- **Linting errors** - ESLint or other linter failures
- **Test failures** - Jest, Mocha, or other test framework failures
- **Build errors** - TypeScript compilation or webpack build failures
- **General errors** - Any line containing "error", "failed", "exception", etc.

### Actionable Suggestions

Based on the detected error patterns, the tool provides specific suggestions:

- For npm errors: Suggests running `npm ci` or checking `package-lock.json`
- For linting errors: Suggests running `npm run lint -- --fix`
- For test failures: Suggests running `npm test` locally
- For TypeScript errors: Suggests running `npm run build`

### Integration with CI/CD Workflows

You can integrate this tool into your development workflow:

1. **After a build failure notification:**
   ```bash
   npm run buildkite:review -- --build 123
   ```

2. **Daily review of failures:**
   ```bash
   npm run buildkite:review -- --branch main --limit 5
   ```

3. **As part of incident response:**
   Use the detailed error analysis to quickly identify and fix issues

## Example Output

### Listing Recent Failures

```
📊 Found 3 recent failed build(s):

================================================================================

Build #456 - Fix linting errors
Branch: feature/lint-fix
Failed Jobs: 2
URL: https://buildkite.com/elastic/my-pipeline/builds/456
--------------------------------------------------------------------------------

Build #455 - Update dependencies
Branch: main
Failed Jobs: 1
URL: https://buildkite.com/elastic/my-pipeline/builds/455
--------------------------------------------------------------------------------

💡 To see detailed analysis of a specific build, run:
   npm run buildkite:review -- --build <number>
```

### Detailed Build Analysis

```
================================================================================
Build #456: Fix linting errors
Branch: feature/lint-fix
URL: https://buildkite.com/elastic/my-pipeline/builds/456
================================================================================

❌ Found 2 failed job(s):

📋 Job: Lint
   Exit Status: 1
   URL: https://buildkite.com/elastic/my-pipeline/builds/456#job-id

   Error Summary:
   ----------------------------------------------------------------------------
   /src/utils/buildkite.ts
     18:10  error  'logger' is defined but never used  @typescript-eslint/no-unused-vars
     55:18  error  'parseError' is defined but never used  @typescript-eslint/no-unused-vars
   ✖ 2 problems (2 errors, 0 warnings)
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
```

## Troubleshooting

### Authentication Errors

If you get a 401 Unauthorized error:
- Verify your `BUILDKITE_TOKEN` is correct
- Check that the token has the required scopes (`read_builds`, `read_build_logs`)
- Ensure the token hasn't expired

### 404 Not Found Errors

If you get a 404 error:
- Verify your `BUILDKITE_ORG` matches your organization slug
- Verify your `BUILDKITE_PIPELINE` matches your pipeline slug
- Check that you have access to the organization and pipeline

### Rate Limiting

Buildkite API has rate limits. If you hit them:
- Reduce the `--limit` parameter
- Wait a few minutes before retrying
- Consider caching results for frequently accessed builds

## Advanced Usage

### Programmatic Access

You can also use the Buildkite utilities programmatically in your code:

```typescript
import { fetchBuilds, analyzeBuildFailures, BuildkiteConfig } from './src/utils/buildkite';

const config: BuildkiteConfig = {
  token: process.env.BUILDKITE_TOKEN!,
  organization: 'elastic',
  pipeline: 'my-pipeline',
};

// Fetch recent failed builds
const builds = await fetchBuilds(config, { state: 'failed', per_page: 5 });

// Analyze a specific build
const analysis = await analyzeBuildFailures(config, 123);
console.log(analysis.failedJobs);
```

### Custom Error Patterns

You can extend the error detection patterns in `src/utils/buildkite.ts` by modifying the `extractErrorSummary` function to include additional patterns specific to your project.

## Security Best Practices

- **Never commit your API token** to version control
- Use environment variables or secure secret management
- Limit token scopes to only what's needed
- Regularly rotate API tokens
- Use fine-grained access tokens when available

## Future Enhancements

Potential improvements for this feature:

- **Automatic fix application**: Integrate with AI to automatically suggest code fixes
- **Historical analysis**: Track failure trends over time
- **Notification integration**: Send alerts when new failures are detected
- **Multi-pipeline support**: Review failures across multiple pipelines
- **Export reports**: Generate HTML or PDF reports of build failures
