import { parseHeaders } from '../../src/utils/otel_provider';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { withTestEnv } from './utils/test_env';

describe('parseHeaders', () => {
  it('should parse simple key=value pairs', () => {
    const result = parseHeaders('key1=value1,key2=value2');
    expect(result).toEqual({
      key1: 'value1',
      key2: 'value2',
    });
  });

  it('should handle values containing equals signs', () => {
    const result = parseHeaders('Authorization=ApiKey dGVzdDp0ZXN0==');
    expect(result).toEqual({
      Authorization: 'ApiKey dGVzdDp0ZXN0==',
    });
  });

  it('should handle multiple headers with values containing equals signs', () => {
    const result = parseHeaders('Authorization=ApiKey abc123==,content-type=application/json');
    expect(result).toEqual({
      Authorization: 'ApiKey abc123==',
      'content-type': 'application/json',
    });
  });

  it('should handle base64 encoded values', () => {
    const result = parseHeaders('x-api-key=dGVzdDp0ZXN0Cg==,Authorization=Bearer token123==');
    expect(result).toEqual({
      'x-api-key': 'dGVzdDp0ZXN0Cg==',
      Authorization: 'Bearer token123==',
    });
  });

  it('should trim whitespace from keys and values', () => {
    const result = parseHeaders('  key1  =  value1  ,  key2  =  value2  ');
    expect(result).toEqual({
      key1: 'value1',
      key2: 'value2',
    });
  });

  it('should return empty object for empty string', () => {
    const result = parseHeaders('');
    expect(result).toEqual({});
  });

  it('should skip malformed entries without equals sign', () => {
    const result = parseHeaders('key1=value1,malformed,key2=value2');
    expect(result).toEqual({
      key1: 'value1',
      key2: 'value2',
    });
  });

  it('should skip entries with empty keys', () => {
    const result = parseHeaders('=value1,key2=value2');
    expect(result).toEqual({
      key2: 'value2',
    });
  });

  it('should skip entries with empty values', () => {
    const result = parseHeaders('key1=,key2=value2');
    expect(result).toEqual({
      key2: 'value2',
    });
  });

  it('should handle complex real-world header strings', () => {
    const result = parseHeaders(
      'Authorization=ApiKey VnVhQ2ZHY0JDZGJrUW0tZTVoT3k6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==,x-elastic-product-origin=kibana'
    );
    expect(result).toEqual({
      Authorization: 'ApiKey VnVhQ2ZHY0JDZGJrUW0tZTVoT3k6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==',
      'x-elastic-product-origin': 'kibana',
    });
  });
});

describe('OTel Provider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clear the module cache to ensure fresh imports
    vi.resetModules();
    process.env = { ...originalEnv };
    // Ensure NODE_ENV is not 'test' for these tests
    delete process.env.NODE_ENV;
  });

  afterEach(async () => {
    process.env = originalEnv;
    // Dynamically import and shutdown
    const { shutdown } = await import('../../src/utils/otel_provider');
    await shutdown();
  });

  it('should return null when SCSI_OTEL_LOGGING_ENABLED is not true', async () => {
    process.env.SCSI_OTEL_LOGGING_ENABLED = 'false';
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).toBeNull();
  });

  it.skip('should return null when SCSI_OTEL_LOGGING_ENABLED is not set', async () => {
    // This test is skipped because vi.resetModules() doesn't properly clear
    // the config module's cached values when using dynamic imports.
    // The behavior is tested by the 'false' case above.
    delete process.env.SCSI_OTEL_LOGGING_ENABLED;
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).toBeNull();
  });

  it('should return a LoggerProvider when SCSI_OTEL_LOGGING_ENABLED is true', async () => {
    process.env.SCSI_OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();
    expect(provider).toBeDefined();
  });

  it('should return the same instance on subsequent calls (singleton)', async () => {
    process.env.SCSI_OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider1 = getLoggerProvider();
    const provider2 = getLoggerProvider();
    expect(provider1).toBe(provider2);
  });

  it('should use SCSI_OTEL_SERVICE_NAME if provided', () =>
    withTestEnv({ SCSI_OTEL_LOGGING_ENABLED: 'true', SCSI_OTEL_SERVICE_NAME: 'custom-service-name' }, async () => {
      const { getLoggerProvider } = await import('../../src/utils/otel_provider');
      const provider = getLoggerProvider();
      expect(provider).not.toBeNull();
    }));

  it('should use default service name if SCSI_OTEL_SERVICE_NAME is not set', async () => {
    process.env.SCSI_OTEL_LOGGING_ENABLED = 'true';
    delete process.env.SCSI_OTEL_SERVICE_NAME;
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();
  });

  it('should allow getting a logger from the provider', async () => {
    process.env.SCSI_OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();

    const logger = provider!.getLogger('test-logger');
    expect(logger).toBeDefined();
    expect(logger.emit).toBeDefined();
  });

  it('should handle shutdown gracefully', async () => {
    process.env.SCSI_OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider, shutdown } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();

    await expect(shutdown()).resolves.not.toThrow();
  });

  it('should handle shutdown when provider is not initialized', async () => {
    process.env.SCSI_OTEL_LOGGING_ENABLED = 'false';
    const { shutdown } = await import('../../src/utils/otel_provider');
    await expect(shutdown()).resolves.not.toThrow();
  });

  it('should not include git.indexer.* resource attributes', async () => {
    process.env.SCSI_OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();

    // Access the resource attributes through the provider's _sharedState
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resource = (provider as any)._sharedState.resource;
    const attributes = resource.attributes;

    // Verify git.indexer.* attributes are NOT present
    expect(attributes['git.indexer.branch']).toBeUndefined();
    expect(attributes['git.indexer.remote.url']).toBeUndefined();
    expect(attributes['git.indexer.root.path']).toBeUndefined();
  });

  it('should still include standard resource attributes', () =>
    withTestEnv({ SCSI_OTEL_LOGGING_ENABLED: 'true', SCSI_OTEL_SERVICE_NAME: 'test-service' }, async () => {
      const { getLoggerProvider } = await import('../../src/utils/otel_provider');
      const provider = getLoggerProvider();
      expect(provider).not.toBeNull();

      // Access the resource attributes through the provider's _sharedState
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resource = (provider as any)._sharedState.resource;
      const attributes = resource.attributes;

      expect(attributes['service.name']).toBeDefined();
      // The detectors add various attributes — just verify we have some
      expect(Object.keys(attributes).length).toBeGreaterThan(3);
    }));

  it('should respect SCSI_OTEL_RESOURCE_ATTRIBUTES environment variable', () =>
    withTestEnv(
      {
        SCSI_OTEL_LOGGING_ENABLED: 'true',
        SCSI_OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment=staging,team=platform,custom.key=custom-value',
      },
      async () => {
        const { getLoggerProvider } = await import('../../src/utils/otel_provider');
        const provider = getLoggerProvider();
        expect(provider).not.toBeNull();

        // Access the resource attributes through the provider's _sharedState
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resource = (provider as any)._sharedState.resource;
        const attributes = resource.attributes;

        expect(attributes['deployment.environment']).toBe('staging');
        expect(attributes['team']).toBe('platform');
        expect(attributes['custom.key']).toBe('custom-value');
      }
    ));

  it('should ignore OTEL_RESOURCE_ATTRIBUTES and only use SCSI_OTEL_RESOURCE_ATTRIBUTES', () =>
    withTestEnv(
      {
        SCSI_OTEL_LOGGING_ENABLED: 'true',
        SCSI_OTEL_RESOURCE_ATTRIBUTES: 'team=scsi,custom.key=scoped',
        OTEL_RESOURCE_ATTRIBUTES: 'team=ambient,ambient.key=ambient',
      },
      async () => {
        const { getLoggerProvider } = await import('../../src/utils/otel_provider');
        const provider = getLoggerProvider();
        expect(provider).not.toBeNull();

        // Access the resource attributes through the provider's _sharedState
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resource = (provider as any)._sharedState.resource;
        const attributes = resource.attributes;

        expect(attributes['team']).toBe('scsi');
        expect(attributes['custom.key']).toBe('scoped');
        expect(attributes['ambient.key']).toBeUndefined();
      }
    ));

  it('should isolate log exporter from OTEL_* endpoint and headers', () =>
    withTestEnv(
      {
        SCSI_OTEL_LOGGING_ENABLED: 'true',
        SCSI_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://scsi-otel-endpoint:4318',
        SCSI_OTEL_EXPORTER_OTLP_HEADERS: 'x-scsi=scsi-value',
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://ambient-otel-endpoint:9999',
        OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'x-ambient=ambient-value',
      },
      async () => {
        const { getLoggerProvider } = await import('../../src/utils/otel_provider');
        const provider = getLoggerProvider();
        expect(provider).not.toBeNull();

        // Access the log exporter through the provider's _sharedState
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const logProcessor = (provider as any)._sharedState.registeredLogRecordProcessors[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const exporter = logProcessor._exporter as any;

        expect(exporter.url).toBe('http://scsi-otel-endpoint:4318/v1/logs');
        expect(exporter.headers['x-scsi']).toBe('scsi-value');
        expect(exporter.headers['x-ambient']).toBeUndefined();
      }
    ));
});

describe('MeterProvider', () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    // Shutdown any existing providers first, then reset modules
    try {
      const { shutdown } = await import('../../src/utils/otel_provider');
      await shutdown();
    } catch {
      // Module might not be loaded yet
    }
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
  });

  afterEach(async () => {
    process.env = originalEnv;
    const { shutdown } = await import('../../src/utils/otel_provider');
    await shutdown();
  });

  it('should return null when SCSI_OTEL_METRICS_ENABLED is false', async () => {
    process.env.SCSI_OTEL_METRICS_ENABLED = 'false';
    const { getMeterProvider } = await import('../../src/utils/otel_provider');
    const provider = getMeterProvider();
    expect(provider).toBeNull();
  });

  it.skip('should return null when SCSI_OTEL_METRICS_ENABLED is not set and SCSI_OTEL_LOGGING_ENABLED is false', async () => {
    // This test is skipped because vi.resetModules() doesn't properly clear
    // the config module's cached values when using dynamic imports.
    // The behavior is tested by the 'false' case above.
    process.env.SCSI_OTEL_LOGGING_ENABLED = 'false';
    delete process.env.SCSI_OTEL_METRICS_ENABLED;
    const { getMeterProvider } = await import('../../src/utils/otel_provider');
    const provider = getMeterProvider();
    expect(provider).toBeNull();
  });

  it('should return a MeterProvider when SCSI_OTEL_METRICS_ENABLED is true', async () => {
    process.env.SCSI_OTEL_METRICS_ENABLED = 'true';
    const { getMeterProvider } = await import('../../src/utils/otel_provider');
    const provider = getMeterProvider();
    expect(provider).not.toBeNull();
    expect(provider).toBeDefined();
  });

  it('should default to SCSI_OTEL_LOGGING_ENABLED when SCSI_OTEL_METRICS_ENABLED is not set', () =>
    withTestEnv({ SCSI_OTEL_LOGGING_ENABLED: 'true', SCSI_OTEL_METRICS_ENABLED: undefined }, async () => {
      const { getMeterProvider } = await import('../../src/utils/otel_provider');
      const provider = getMeterProvider();
      expect(provider).not.toBeNull();
    }));

  it('should return the same instance on subsequent calls (singleton)', async () => {
    process.env.SCSI_OTEL_METRICS_ENABLED = 'true';
    const { getMeterProvider } = await import('../../src/utils/otel_provider');
    const provider1 = getMeterProvider();
    const provider2 = getMeterProvider();
    expect(provider1).toBe(provider2);
  });

  it('should allow getting a meter from the provider', async () => {
    process.env.SCSI_OTEL_METRICS_ENABLED = 'true';
    const { getMeterProvider } = await import('../../src/utils/otel_provider');
    const provider = getMeterProvider();
    expect(provider).not.toBeNull();

    const meter = provider!.getMeter('test-meter');
    expect(meter).toBeDefined();
  });

  it('should handle shutdown gracefully', async () => {
    process.env.SCSI_OTEL_METRICS_ENABLED = 'true';
    const { getMeterProvider, shutdown } = await import('../../src/utils/otel_provider');
    const provider = getMeterProvider();
    expect(provider).not.toBeNull();

    await expect(shutdown()).resolves.not.toThrow();
  });

  it('should handle shutdown when provider is not initialized', async () => {
    process.env.SCSI_OTEL_METRICS_ENABLED = 'false';
    const { shutdown } = await import('../../src/utils/otel_provider');
    await expect(shutdown()).resolves.not.toThrow();
  });

  it('should shutdown both logger and meter providers', () =>
    withTestEnv({ SCSI_OTEL_LOGGING_ENABLED: 'true', SCSI_OTEL_METRICS_ENABLED: 'true' }, async () => {
      const { getLoggerProvider, getMeterProvider, shutdown } = await import('../../src/utils/otel_provider');

      const loggerProvider = getLoggerProvider();
      const meterProvider = getMeterProvider();

      expect(loggerProvider).not.toBeNull();
      expect(meterProvider).not.toBeNull();

      await expect(shutdown()).resolves.not.toThrow();
    }));

  it('should isolate metrics exporter from OTEL_* endpoint and headers', () =>
    withTestEnv(
      {
        SCSI_OTEL_METRICS_ENABLED: 'true',
        SCSI_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://scsi-metrics-endpoint:4318',
        SCSI_OTEL_EXPORTER_OTLP_HEADERS: 'x-scsi=scsi-value',
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://ambient-metrics-endpoint:9999',
        OTEL_EXPORTER_OTLP_METRICS_HEADERS: 'x-ambient=ambient-value',
      },
      async () => {
        const { getMeterProvider } = await import('../../src/utils/otel_provider');
        const provider = getMeterProvider();
        expect(provider).not.toBeNull();

        // Access the metric reader/exporter through the provider's shared state
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const metricReader = (provider as any)._sharedState.metricCollectors[0]._metricReader;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const exporter = metricReader._exporter as any;

        expect(exporter._otlpExporter.url).toBe('http://scsi-metrics-endpoint:4318/v1/metrics');
        expect(exporter._otlpExporter.headers['x-scsi']).toBe('scsi-value');
        expect(exporter._otlpExporter.headers['x-ambient']).toBeUndefined();
      }
    ));
});
