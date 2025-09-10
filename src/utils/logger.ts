// src/utils/logger.ts
import { Client, ClientOptions } from '@elastic/elasticsearch';
import { elasticsearchConfig, appConfig } from '../config';
import { findProjectRoot } from './find_project_root';
import { execSync } from 'child_process';
import os from 'os';

enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

interface LogEntry {
  '@timestamp': string;
  'log.level': LogLevel;
  message: string;
  [key: string]: unknown;
}

let esClient: Client | null = null;
let gitInfo: { branch: string; remoteUrl: string; rootPath: string } | null = null;
let gitInfoInitialized = false;
let isSilent = false;

function getGitInfo() {
  if (gitInfoInitialized) {
    return gitInfo;
  }
  gitInfoInitialized = true;

  try {
    const rootPath = findProjectRoot(process.cwd()) || process.cwd();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootPath }).toString().trim();
    const remoteUrl = execSync('git config --get remote.origin.url', { cwd: rootPath }).toString().trim();
    gitInfo = { branch, remoteUrl, rootPath };
  } catch (error) {
    console.error('Could not get git info', error);
  }
  return gitInfo;
}


if (elasticsearchConfig.logging && process.env.NODE_ENV !== 'test') {
  const baseOptions: Partial<ClientOptions> = {
    requestTimeout: 10000, // 10 seconds
  };

  if (elasticsearchConfig.cloudId) {
    esClient = new Client({
      ...baseOptions,
      cloud: {
        id: elasticsearchConfig.cloudId,
      },
      auth: {
        apiKey: elasticsearchConfig.apiKey || '',
      },
    });
  } else if (elasticsearchConfig.endpoint) {
    const clientOptions: ClientOptions = {
      ...baseOptions,
      node: elasticsearchConfig.endpoint,
    };

    if (elasticsearchConfig.apiKey) {
      clientOptions.auth = { apiKey: elasticsearchConfig.apiKey };
    } else if (elasticsearchConfig.username && elasticsearchConfig.password) {
      clientOptions.auth = {
        username: elasticsearchConfig.username,
        password: elasticsearchConfig.password,
      };
    }
    esClient = new Client(clientOptions);
  }
}

function log(level: LogLevel, message: string, metadata: object = {}) {
  if (isSilent) {
    return;
  }
  const logEntry: LogEntry = {
    '@timestamp': new Date().toISOString(),
    'log.level': level,
    message,
    data_stream: {
      type: 'logs',
      namespace: 'default',
      dataset: 'semantic.codesearch',
    },
    codesearch: {
      ...getGitInfo(),
    },
    host: {
      hostname: os.hostname(),
      type: os.type(),
      platform: os.platform(),
      architecture: os.arch(),
      total_memory: os.totalmem(),
    },
    ...metadata,
  };

  

  if (process.env.LOG_FORMAT === 'text') {
    const metadataString = Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : '';
    console.log(`[${logEntry['@timestamp']}] [${logEntry['log.level']}] ${logEntry.message}${metadataString}`);
  } else {
    console.log(JSON.stringify(logEntry));
  }

  if (esClient) {
    esClient.index({
      index: 'logs-semantic.codesearch-default',
      document: logEntry,
    }).catch(error => {
      console.error('Failed to send log to Elasticsearch:', error);
    });
  }
}

export const logger = {
  info: (message: string, metadata?: object) => log(LogLevel.INFO, message, metadata),
  warn: (message: string, metadata?: object) => log(LogLevel.WARN, message, metadata),
  error: (message: string, metadata?: object) => log(LogLevel.ERROR, message, metadata),
  debug: (message: string, metadata?: object) => log(LogLevel.DEBUG, message, metadata),
  set silent(value: boolean) {
    isSilent = value;
  },
  get silent() {
    return isSilent;
  }
};