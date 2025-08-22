// src/utils/logger.ts

enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: any; // For additional metadata
}

function log(level: LogLevel, message: string, metadata: object = {}) {
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata,
  };
  console.log(JSON.stringify(logEntry));
}

export const logger = {
  info: (message: string, metadata?: object) => log(LogLevel.INFO, message, metadata),
  warn: (message: string, metadata?: object) => log(LogLevel.WARN, message, metadata),
  error: (message: string, metadata?: object) => log(LogLevel.ERROR, message, metadata),
  debug: (message: string, metadata?: object) => log(LogLevel.DEBUG, message, metadata),
};
