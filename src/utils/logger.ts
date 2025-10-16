// src/utils/logger.ts
import { getLoggerProvider } from './otel_provider';
import { SeverityNumber } from '@opentelemetry/api-logs';

enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

const LOG_LEVEL_TO_SEVERITY: Record<LogLevel, SeverityNumber> = {
  [LogLevel.DEBUG]: SeverityNumber.DEBUG,
  [LogLevel.INFO]: SeverityNumber.INFO,
  [LogLevel.WARN]: SeverityNumber.WARN,
  [LogLevel.ERROR]: SeverityNumber.ERROR,
};

interface RepoInfo {
  name: string;
  branch: string;
}

function log(level: LogLevel, message: string, metadata: object = {}, repoInfo?: RepoInfo) {
  // Silent mode: skip console output in test environment
  if (process.env.NODE_ENV !== 'test') {
    // Always output text to console (unless in test mode)
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
  }

  // Send to OTel if enabled
  const loggerProvider = getLoggerProvider();
  if (loggerProvider) {
    const logger = loggerProvider.getLogger('default');
    
    const attributes: Record<string, string | number | boolean> = {
      ...metadata as Record<string, string | number | boolean>,
    };

    if (repoInfo) {
      attributes['repo.name'] = repoInfo.name;
      attributes['repo.branch'] = repoInfo.branch;
    }

    logger.emit({
      severityNumber: LOG_LEVEL_TO_SEVERITY[level],
      severityText: level,
      body: message,
      attributes,
    });
  }
}

export function createLogger(repoInfo?: RepoInfo) {
  return {
    info: (message: string, metadata?: object) => log(LogLevel.INFO, message, metadata, repoInfo),
    warn: (message: string, metadata?: object) => log(LogLevel.WARN, message, metadata, repoInfo),
    error: (message: string, metadata?: object) => log(LogLevel.ERROR, message, metadata, repoInfo),
    debug: (message: string, metadata?: object) => log(LogLevel.DEBUG, message, metadata, repoInfo),
  };
}

export const logger = createLogger();
