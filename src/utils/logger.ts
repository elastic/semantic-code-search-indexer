// src/utils/logger.ts
import { getLoggerProvider } from './otel_provider';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { ATTR_REPO_NAME, ATTR_REPO_BRANCH } from './constants';

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

/**
 * Internal logging function that handles both console and OpenTelemetry output.
 *
 * - Outputs text format logs to console (unless NODE_ENV=test)
 * - Sends structured logs to OpenTelemetry collector if enabled
 * - Attaches repository context and custom metadata to OTel logs
 *
 * @param level - The log level (INFO, WARN, ERROR, DEBUG).
 * @param message - The log message.
 * @param metadata - Additional metadata to attach to the log entry.
 * @param repoInfo - Optional repository context (name and branch).
 */
function log(level: LogLevel, message: string, metadata: object = {}, repoInfo?: RepoInfo) {
  // Silent mode: skip console output in test environment
  if (process.env.NODE_ENV !== 'test' || process.env.FORCE_LOGGING === 'true') {
    // Always output text to console (unless in test mode without FORCE_LOGGING)
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
  }

  // Send to OTel if enabled
  const loggerProvider = getLoggerProvider();
  if (loggerProvider) {
    const logger = loggerProvider.getLogger('default');

    const attributes: Record<string, string | number | boolean> = {
      ...(metadata as Record<string, string | number | boolean>),
    };

    if (repoInfo) {
      attributes[ATTR_REPO_NAME] = repoInfo.name;
      attributes[ATTR_REPO_BRANCH] = repoInfo.branch;
    }

    logger.emit({
      severityNumber: LOG_LEVEL_TO_SEVERITY[level],
      severityText: level,
      body: message,
      attributes,
    });
  }
}

/**
 * Creates a logger instance with optional repository context.
 *
 * The logger provides methods for logging at different severity levels (info, warn, error, debug).
 * If repository information is provided, it will be attached to all log entries from this logger.
 *
 * @param repoInfo - Optional repository context to attach to all logs (name and branch).
 * @returns A logger object with info, warn, error, and debug methods.
 *
 * @example
 * // Create a logger without context
 * const logger = createLogger();
 * logger.info('Application started');
 *
 * @example
 * // Create a logger with repository context
 * const repoLogger = createLogger({ name: 'kibana', branch: 'main' });
 * repoLogger.info('Processing repository', { fileCount: 42 });
 */
export function createLogger(repoInfo?: RepoInfo) {
  return {
    info: (message: string, metadata?: object) => log(LogLevel.INFO, message, metadata, repoInfo),
    warn: (message: string, metadata?: object) => log(LogLevel.WARN, message, metadata, repoInfo),
    error: (message: string, metadata?: object) => log(LogLevel.ERROR, message, metadata, repoInfo),
    debug: (message: string, metadata?: object) => log(LogLevel.DEBUG, message, metadata, repoInfo),
  };
}

export const logger = createLogger();
