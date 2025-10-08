// src/commands/buildkite_review_command.ts
import { Command, Option } from 'commander';
import { logger } from '../utils/logger';
import { 
  fetchBuilds, 
  analyzeBuildFailures,
  BuildkiteConfig,
  FailureAnalysis 
} from '../utils/buildkite';

export const buildkiteReviewCommand = new Command('buildkite:review')
  .description('Review build failures from Buildkite and provide analysis')
  .addOption(
    new Option('--token <token>', 'Buildkite API token')
      .env('BUILDKITE_TOKEN')
  )
  .addOption(
    new Option('--org <organization>', 'Buildkite organization slug')
      .env('BUILDKITE_ORG')
  )
  .addOption(
    new Option('--pipeline <pipeline>', 'Buildkite pipeline slug')
      .env('BUILDKITE_PIPELINE')
  )
  .addOption(
    new Option('--build <number>', 'Specific build number to review')
  )
  .addOption(
    new Option('--branch <branch>', 'Filter builds by branch')
  )
  .addOption(
    new Option('--limit <number>', 'Number of builds to review')
      .default(5)
  )
  .action(async (options) => {
    const { token, org, pipeline, build, branch, limit } = options;

    // Validate required options
    if (!token) {
      logger.error('Buildkite API token is required. Set BUILDKITE_TOKEN environment variable or use --token option.');
      process.exit(1);
    }

    if (!org) {
      logger.error('Buildkite organization is required. Set BUILDKITE_ORG environment variable or use --org option.');
      process.exit(1);
    }

    if (!pipeline) {
      logger.error('Buildkite pipeline is required. Set BUILDKITE_PIPELINE environment variable or use --pipeline option.');
      process.exit(1);
    }

    const config: BuildkiteConfig = {
      token,
      organization: org,
      pipeline,
    };

    try {
      if (build) {
        // Review a specific build
        await reviewSpecificBuild(config, parseInt(build, 10));
      } else {
        // Review recent failed builds
        await reviewRecentFailures(config, branch, parseInt(limit, 10));
      }
    } catch (error) {
      logger.error('Failed to review Buildkite builds', { error });
      process.exit(1);
    }
  });

async function reviewSpecificBuild(config: BuildkiteConfig, buildNumber: number) {
  logger.info(`Reviewing Buildkite build #${buildNumber}...`);
  
  const analysis = await analyzeBuildFailures(config, buildNumber);
  
  console.log('\n' + '='.repeat(80));
  console.log(`Build #${analysis.buildNumber}: ${analysis.message}`);
  console.log(`Branch: ${analysis.branch}`);
  console.log(`URL: ${analysis.webUrl}`);
  console.log('='.repeat(80) + '\n');

  if (analysis.failedJobs.length === 0) {
    console.log('✅ No failed jobs found in this build.\n');
    return;
  }

  console.log(`❌ Found ${analysis.failedJobs.length} failed job(s):\n`);

  for (const job of analysis.failedJobs) {
    console.log(`📋 Job: ${job.name}`);
    console.log(`   Exit Status: ${job.exitStatus ?? 'N/A'}`);
    console.log(`   URL: ${job.webUrl}`);
    console.log('\n   Error Summary:');
    console.log('   ' + '-'.repeat(76));
    
    const errorLines = job.errorSummary.split('\n');
    errorLines.forEach(line => {
      console.log(`   ${line}`);
    });
    
    console.log('   ' + '-'.repeat(76) + '\n');
  }

  displayFixSuggestions(analysis);
}

async function reviewRecentFailures(config: BuildkiteConfig, branch?: string, limit: number = 5) {
  logger.info('Fetching recent failed builds from Buildkite...');
  
  const builds = await fetchBuilds(config, {
    state: 'failed',
    branch,
    per_page: limit,
  });

  if (builds.length === 0) {
    console.log('\n✅ No recent failed builds found.\n');
    return;
  }

  console.log(`\n📊 Found ${builds.length} recent failed build(s):\n`);
  console.log('='.repeat(80));

  for (const build of builds) {
    const failedJobCount = build.jobs.filter(j => j.state === 'failed').length;
    console.log(`\nBuild #${build.number} - ${build.message}`);
    console.log(`Branch: ${build.branch}`);
    console.log(`Failed Jobs: ${failedJobCount}`);
    console.log(`URL: ${build.web_url}`);
    console.log('-'.repeat(80));
  }

  console.log('\n💡 To see detailed analysis of a specific build, run:');
  console.log(`   npm run buildkite:review -- --build <number>\n`);
}

function displayFixSuggestions(analysis: FailureAnalysis) {
  console.log('\n💡 Suggested Actions:\n');
  console.log('1. Review the error logs above to identify the root cause');
  console.log('2. Check if the failure is related to:');
  console.log('   - Dependency issues (run: npm install or update dependencies)');
  console.log('   - Linting errors (run: npm run lint)');
  console.log('   - Test failures (run: npm test)');
  console.log('   - Build errors (run: npm run build)');
  console.log('3. Fix the identified issues locally and push changes');
  console.log('4. Monitor the next build to verify the fix\n');
  
  // Additional context-specific suggestions based on error patterns
  const allErrors = analysis.failedJobs.map(j => j.errorSummary).join('\n');
  
  if (allErrors.includes('npm ERR!') || allErrors.includes('package')) {
    console.log('⚠️  Detected npm/package issues - Consider:');
    console.log('   - Running: npm ci (clean install)');
    console.log('   - Checking package-lock.json for conflicts');
    console.log('   - Verifying Node.js version compatibility\n');
  }
  
  if (allErrors.match(/lint|eslint/i)) {
    console.log('⚠️  Detected linting issues - Consider:');
    console.log('   - Running: npm run lint -- --fix');
    console.log('   - Reviewing ESLint configuration\n');
  }
  
  if (allErrors.match(/test.*fail|jest|spec/i)) {
    console.log('⚠️  Detected test failures - Consider:');
    console.log('   - Running tests locally: npm test');
    console.log('   - Checking for environment-specific issues\n');
  }
  
  if (allErrors.match(/typescript|\.ts|tsc/i)) {
    console.log('⚠️  Detected TypeScript issues - Consider:');
    console.log('   - Running: npm run build');
    console.log('   - Checking type definitions and imports\n');
  }
}
