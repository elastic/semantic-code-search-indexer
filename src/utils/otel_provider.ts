// src/utils/otel_provider.ts
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { otelConfig } from '../config';
import { findProjectRoot } from './find_project_root';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

let loggerProvider: LoggerProvider | null = null;

function getGitInfo(): { branch: string; remoteUrl: string; rootPath: string } | null {
  try {
    const rootPath = findProjectRoot(process.cwd()) || process.cwd();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootPath }).toString().trim();
    const remoteUrl = execSync('git config --get remote.origin.url', { cwd: rootPath }).toString().trim();
    return { branch, remoteUrl, rootPath };
  } catch (error) {
    console.error('Could not get git info', error);
    return null;
  }
}

function getServiceVersion(): string {
  try {
    const rootPath = findProjectRoot(process.cwd()) || process.cwd();
    const packageJsonPath = path.join(rootPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.version || '1.0.0';
    }
  } catch (error) {
    console.error('Could not get service version', error);
  }
  return '1.0.0';
}

function parseHeaders(headersString: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!headersString) return headers;

  headersString.split(',').forEach(header => {
    const [key, value] = header.split('=');
    if (key && value) {
      headers[key.trim()] = value.trim();
    }
  });
  return headers;
}

export function getLoggerProvider(): LoggerProvider | null {
  if (!otelConfig.enabled) {
    return null;
  }

  if (loggerProvider) {
    return loggerProvider;
  }

  const gitInfo = getGitInfo();
  const serviceVersion = getServiceVersion();

  const resourceAttributes: Record<string, string | number> = {
    'service.name': otelConfig.serviceName,
    'service.version': serviceVersion,
    'deployment.environment': process.env.NODE_ENV || 'production',
    'host.name': os.hostname(),
    'host.arch': os.arch(),
    'host.type': os.type(),
    'os.type': os.platform(),
  };

  if (gitInfo) {
    resourceAttributes['git.indexer.branch'] = gitInfo.branch;
    resourceAttributes['git.indexer.remote.url'] = gitInfo.remoteUrl;
    resourceAttributes['git.indexer.root.path'] = gitInfo.rootPath;
  }

  const resource = new Resource(resourceAttributes);

  const exporter = new OTLPLogExporter({
    url: otelConfig.endpoint.endsWith('/v1/logs') 
      ? otelConfig.endpoint 
      : `${otelConfig.endpoint}/v1/logs`,
    headers: parseHeaders(otelConfig.headers),
  });

  loggerProvider = new LoggerProvider({
    resource,
  });

  loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(exporter));

  return loggerProvider;
}

export async function shutdown(): Promise<void> {
  if (loggerProvider) {
    await loggerProvider.shutdown();
  }
}
