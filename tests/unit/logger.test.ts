import { createLogger, logger } from '../../src/utils/logger';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';

describe('Logger', () => {
  const originalEnv = process.env;
  let consoleLogSpy: Mock;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    // Note: Vitest's restoreMocks:true automatically restores spies
  });

  describe('console output', () => {
    describe('when NODE_ENV is not `test`', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
        process.env.OTEL_LOGGING_ENABLED = 'false';
      });

      it('outputs to the console', () => {
        logger.info('test message');

        expect(consoleLogSpy).toHaveBeenCalled();
      });

      it('includes the log level in the output', () => {
        logger.info('test message');

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('[INFO]');
      });

      it('includes the message in the output', () => {
        logger.info('test message');

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('test message');
      });

      it('includes an ISO timestamp in the output', () => {
        logger.info('test message');

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
      });
    });

    describe('when NODE_ENV is `test`', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'test';
        process.env.OTEL_LOGGING_ENABLED = 'false';
      });

      it('does not output to the console', () => {
        logger.info('test message');

        expect(consoleLogSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('log levels', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.OTEL_LOGGING_ENABLED = 'false';
    });

    describe('.info()', () => {
      it('outputs with INFO level', () => {
        logger.info('info message');

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('[INFO]');
      });

      it('outputs the provided message', () => {
        logger.info('info message');

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('info message');
      });
    });

    describe('.warn()', () => {
      it('outputs with WARN level', () => {
        logger.warn('warn message');

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('[WARN]');
      });

      it('outputs the provided message', () => {
        logger.warn('warn message');

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('warn message');
      });
    });

    describe('.error()', () => {
      it('outputs with ERROR level', () => {
        logger.error('error message');

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('[ERROR]');
      });

      it('outputs the provided message', () => {
        logger.error('error message');

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('error message');
      });
    });

    describe('.debug()', () => {
      it('outputs with DEBUG level', () => {
        logger.debug('debug message');

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('[DEBUG]');
      });

      it('outputs the provided message', () => {
        logger.debug('debug message');

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('debug message');
      });
    });
  });

  describe('createLogger', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.OTEL_LOGGING_ENABLED = 'false';
    });

    describe('when created with repository context', () => {
      it('outputs logs to console', () => {
        const repoLogger = createLogger({ name: 'kibana', branch: 'main' });

        repoLogger.info('test message');

        expect(consoleLogSpy).toHaveBeenCalled();
      });

      it('includes the message in the output', () => {
        const repoLogger = createLogger({ name: 'kibana', branch: 'main' });

        repoLogger.info('test message');

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('test message');
      });
    });

    describe('when provided with metadata', () => {
      it('outputs the message', () => {
        logger.info('test message', { key: 'value', count: 42 });

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('test message');
      });

      it('does not include metadata in console output', () => {
        logger.info('test message', { key: 'value', count: 42 });

        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).not.toContain('key');
        expect(logOutput).not.toContain('value');
      });
    });
  });

  describe('repository context', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      process.env.OTEL_LOGGING_ENABLED = 'false';
    });

    it('allows creating a logger with repository name and branch', () => {
      expect(() => {
        const repoLogger = createLogger({ name: 'kibana', branch: 'main' });
        repoLogger.info('test message');
      }).not.toThrow();
    });

    it('allows creating a logger without repository context', () => {
      expect(() => {
        const defaultLogger = createLogger();
        defaultLogger.info('test message');
      }).not.toThrow();
    });

    it('creates a logger that has all required methods', () => {
      const repoLogger = createLogger({ name: 'elasticsearch', branch: 'feature-branch' });

      expect(repoLogger.info).toBeDefined();
      expect(repoLogger.warn).toBeDefined();
      expect(repoLogger.error).toBeDefined();
      expect(repoLogger.debug).toBeDefined();

      expect(typeof repoLogger.info).toBe('function');
      expect(typeof repoLogger.warn).toBe('function');
      expect(typeof repoLogger.error).toBe('function');
      expect(typeof repoLogger.debug).toBe('function');
    });
  });

  describe('OpenTelemetry integration', () => {
    describe('when OTEL is disabled', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
        process.env.OTEL_LOGGING_ENABLED = 'false';
      });

      it('does not throw errors', () => {
        expect(() => {
          logger.info('test message');
          logger.warn('warn message');
          logger.error('error message');
          logger.debug('debug message');
        }).not.toThrow();
      });
    });

    describe('when OTEL is enabled', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
        process.env.OTEL_LOGGING_ENABLED = 'true';
      });

      it('does not throw errors', () => {
        expect(() => {
          logger.info('test message');
          logger.warn('warn message');
          logger.error('error message');
          logger.debug('debug message');
        }).not.toThrow();
      });
    });
  });

  describe('API compatibility', () => {
    it('exposes an info method', () => {
      expect(logger.info).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });

    it('exposes a warn method', () => {
      expect(logger.warn).toBeDefined();
      expect(typeof logger.warn).toBe('function');
    });

    it('exposes an error method', () => {
      expect(logger.error).toBeDefined();
      expect(typeof logger.error).toBe('function');
    });

    it('exposes a debug method', () => {
      expect(logger.debug).toBeDefined();
      expect(typeof logger.debug).toBe('function');
    });

    it('does not expose a silent property', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((logger as any).silent).toBeUndefined();
    });
  });
});
