// tests/logger.test.ts
import { createLogger, logger } from '../src/utils/logger';

describe('Logger', () => {
  const originalEnv = process.env;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleLogSpy.mockRestore();
  });

  describe('Console output', () => {
    it('should output to console when NODE_ENV is not test', () => {
      process.env.NODE_ENV = 'production';
      process.env.OTEL_LOGGING_ENABLED = 'false';
      
      logger.info('test message');
      
      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      expect(logOutput).toContain('[INFO]');
      expect(logOutput).toContain('test message');
    });

    it('should not output to console when NODE_ENV is test', () => {
      process.env.NODE_ENV = 'test';
      process.env.OTEL_LOGGING_ENABLED = 'false';
      
      logger.info('test message');
      
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should include timestamp in console output', () => {
      process.env.NODE_ENV = 'production';
      process.env.OTEL_LOGGING_ENABLED = 'false';
      
      logger.info('test message');
      
      const logOutput = consoleLogSpy.mock.calls[0][0];
      expect(logOutput).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });
  });

  describe('Log levels', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.OTEL_LOGGING_ENABLED = 'false';
    });

    it('should log INFO messages', () => {
      logger.info('info message');
      
      const logOutput = consoleLogSpy.mock.calls[0][0];
      expect(logOutput).toContain('[INFO]');
      expect(logOutput).toContain('info message');
    });

    it('should log WARN messages', () => {
      logger.warn('warn message');
      
      const logOutput = consoleLogSpy.mock.calls[0][0];
      expect(logOutput).toContain('[WARN]');
      expect(logOutput).toContain('warn message');
    });

    it('should log ERROR messages', () => {
      logger.error('error message');
      
      const logOutput = consoleLogSpy.mock.calls[0][0];
      expect(logOutput).toContain('[ERROR]');
      expect(logOutput).toContain('error message');
    });

    it('should log DEBUG messages', () => {
      logger.debug('debug message');
      
      const logOutput = consoleLogSpy.mock.calls[0][0];
      expect(logOutput).toContain('[DEBUG]');
      expect(logOutput).toContain('debug message');
    });
  });

  describe('Logger with repository context', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.OTEL_LOGGING_ENABLED = 'false';
    });

    it('should create logger with repo info', () => {
      const repoLogger = createLogger({ name: 'kibana', branch: 'main' });
      
      repoLogger.info('test message');
      
      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      expect(logOutput).toContain('test message');
    });

    it('should handle metadata in log calls', () => {
      logger.info('test message', { key: 'value', count: 42 });
      
      expect(consoleLogSpy).toHaveBeenCalled();
      // Metadata should not appear in console output (only sent to OTel)
      const logOutput = consoleLogSpy.mock.calls[0][0];
      expect(logOutput).toContain('test message');
    });
  });

  describe('OpenTelemetry integration', () => {
    it('should not throw when OTEL is disabled', () => {
      process.env.NODE_ENV = 'production';
      process.env.OTEL_LOGGING_ENABLED = 'false';
      
      expect(() => {
        logger.info('test message');
        logger.warn('warn message');
        logger.error('error message');
        logger.debug('debug message');
      }).not.toThrow();
    });

    it('should not throw when OTEL is enabled', () => {
      process.env.NODE_ENV = 'production';
      process.env.OTEL_LOGGING_ENABLED = 'true';
      
      expect(() => {
        logger.info('test message');
        logger.warn('warn message');
        logger.error('error message');
        logger.debug('debug message');
      }).not.toThrow();
    });
  });

  describe('API compatibility', () => {
    it('should expose info method', () => {
      expect(logger.info).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });

    it('should expose warn method', () => {
      expect(logger.warn).toBeDefined();
      expect(typeof logger.warn).toBe('function');
    });

    it('should expose error method', () => {
      expect(logger.error).toBeDefined();
      expect(typeof logger.error).toBe('function');
    });

    it('should expose debug method', () => {
      expect(logger.debug).toBeDefined();
      expect(typeof logger.debug).toBe('function');
    });

    it('should not expose silent property', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((logger as any).silent).toBeUndefined();
    });
  });
});
