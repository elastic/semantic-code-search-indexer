// src/utils/buildkite.ts
import https from 'https';
import { URL } from 'url';

export interface BuildkiteBuild {
  id: string;
  number: number;
  state: string;
  branch: string;
  message: string;
  created_at: string;
  web_url: string;
  jobs: BuildkiteJob[];
}

export interface BuildkiteJob {
  id: string;
  name: string;
  state: string;
  exit_status: number | null;
  log_url?: string;
  web_url: string;
}

export interface BuildkiteConfig {
  token: string;
  organization: string;
  pipeline: string;
}

/**
 * Fetches builds from Buildkite API
 */
export async function fetchBuilds(
  config: BuildkiteConfig,
  options: { state?: string; branch?: string; per_page?: number } = {}
): Promise<BuildkiteBuild[]> {
  const { state = 'failed', branch, per_page = 10 } = options;
  
  const params = new URLSearchParams({
    state,
    per_page: per_page.toString(),
  });
  
  if (branch) {
    params.append('branch', branch);
  }

  const url = new URL(
    `https://api.buildkite.com/v2/organizations/${config.organization}/pipelines/${config.pipeline}/builds?${params}`
  );

  return makeRequest<BuildkiteBuild[]>(url.toString(), config.token);
}

/**
 * Fetches a specific build by number
 */
export async function fetchBuild(
  config: BuildkiteConfig,
  buildNumber: number
): Promise<BuildkiteBuild> {
  const url = `https://api.buildkite.com/v2/organizations/${config.organization}/pipelines/${config.pipeline}/builds/${buildNumber}`;
  return makeRequest<BuildkiteBuild>(url, config.token);
}

/**
 * Fetches the log output for a specific job
 */
export async function fetchJobLog(
  logUrl: string,
  token: string
): Promise<string> {
  return makeRequest<string>(logUrl, token);
}

/**
 * Generic function to make HTTPS requests to Buildkite API
 */
function makeRequest<T>(url: string, token: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            // For log endpoints, the response might be plain text
            if (url.includes('/log')) {
              resolve(data as T);
            } else {
              resolve(JSON.parse(data) as T);
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

/**
 * Analyzes build failures and extracts key information
 */
export interface FailureAnalysis {
  buildNumber: number;
  branch: string;
  message: string;
  failedJobs: Array<{
    name: string;
    exitStatus: number | null;
    errorSummary: string;
    webUrl: string;
  }>;
  webUrl: string;
}

export async function analyzeBuildFailures(
  config: BuildkiteConfig,
  buildNumber: number
): Promise<FailureAnalysis> {
  const build = await fetchBuild(config, buildNumber);
  
  const failedJobs = build.jobs
    .filter(job => job.state === 'failed')
    .map(job => ({
      name: job.name,
      exitStatus: job.exit_status,
      errorSummary: 'Failed to fetch error details', // Will be populated from logs
      webUrl: job.web_url,
    }));

  // Fetch logs for failed jobs
  for (let i = 0; i < failedJobs.length; i++) {
    const job = build.jobs.find(j => j.name === failedJobs[i].name);
    if (job?.log_url) {
      try {
        const log = await fetchJobLog(job.log_url, config.token);
        failedJobs[i].errorSummary = extractErrorSummary(log);
      } catch (error) {
        failedJobs[i].errorSummary = `Failed to fetch log: ${error}`;
      }
    }
  }

  return {
    buildNumber: build.number,
    branch: build.branch,
    message: build.message,
    failedJobs,
    webUrl: build.web_url,
  };
}

/**
 * Extracts a summary of errors from a job log
 */
function extractErrorSummary(log: string): string {
  const lines = log.split('\n');
  const errorLines: string[] = [];
  
  // Look for common error patterns
  const errorPatterns = [
    /error:/i,
    /failed:/i,
    /exception:/i,
    /fatal:/i,
    /\[error\]/i,
    /npm ERR!/,
    /✖/,
    /×/,
  ];

  for (const line of lines) {
    if (errorPatterns.some(pattern => pattern.test(line))) {
      errorLines.push(line.trim());
      if (errorLines.length >= 10) break; // Limit to first 10 error lines
    }
  }

  return errorLines.length > 0 
    ? errorLines.join('\n') 
    : 'No specific error pattern found in logs';
}
