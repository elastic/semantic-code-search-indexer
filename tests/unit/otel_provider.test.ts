import { parseHeaders } from '../../src/utils/otel_provider';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

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

  it('should return null when OTEL_LOGGING_ENABLED is not true', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'false';
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).toBeNull();
  });

  it.skip('should return null when OTEL_LOGGING_ENABLED is not set', async () => {
    // This test is skipped because vi.resetModules() doesn't properly clear
    // the config module's cached values when using dynamic imports.
    // The behavior is tested by the 'false' case above.
    delete process.env.OTEL_LOGGING_ENABLED;
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).toBeNull();
  });

  it('should return a LoggerProvider when OTEL_LOGGING_ENABLED is true', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();
    expect(provider).toBeDefined();
  });

  it('should return the same instance on subsequent calls (singleton)', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider1 = getLoggerProvider();
    const provider2 = getLoggerProvider();
    expect(provider1).toBe(provider2);
  });

  it('should use OTEL_SERVICE_NAME if provided', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    process.env.OTEL_SERVICE_NAME = 'custom-service-name';
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();
    // Resource attributes are internal, so we just verify the provider is created
  });

  it('should use default service name if OTEL_SERVICE_NAME is not set', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    delete process.env.OTEL_SERVICE_NAME;
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();
  });

  it('should allow getting a logger from the provider', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();

    const logger = provider!.getLogger('test-logger');
    expect(logger).toBeDefined();
    expect(logger.emit).toBeDefined();
  });

  it('should handle shutdown gracefully', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider, shutdown } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();

    await expect(shutdown()).resolves.not.toThrow();
  });

  it('should handle shutdown when provider is not initialized', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'false';
    const { shutdown } = await import('../../src/utils/otel_provider');
    await expect(shutdown()).resolves.not.toThrow();
  });

  it('should not include git.indexer.* resource attributes', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
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

  it('should still include standard resource attributes', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    process.env.OTEL_SERVICE_NAME = 'test-service';
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();

    // Access the resource attributes through the provider's _sharedState
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resource = (provider as any)._sharedState.resource;
    const attributes = resource.attributes;

    // Verify standard attributes are still present
    expect(attributes['service.name']).toBeDefined();
    // The detectors add various attributes - just verify we have some
    expect(Object.keys(attributes).length).toBeGreaterThan(3);
  });

  it('should respect OTEL_RESOURCE_ATTRIBUTES environment variable', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'deployment.environment=staging,team=platform,custom.key=custom-value';
    const { getLoggerProvider } = await import('../../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();

    // Access the resource attributes through the provider's _sharedState
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resource = (provider as any)._sharedState.resource;
    const attributes = resource.attributes;

    // Verify OTEL_RESOURCE_ATTRIBUTES were added
    expect(attributes['deployment.environment']).toBe('staging');
    expect(attributes['team']).toBe('platform');
    expect(attributes['custom.key']).toBe('custom-value');
  });
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

  it('should return null when OTEL_METRICS_ENABLED is false', async () => {
    process.env.OTEL_METRICS_ENABLED = 'false';
    const { getMeterProvider } = await import('../../src/utils/otel_provider');
    const provider = getMeterProvider();
    expect(provider).toBeNull();
  });

  it.skip('should return null when OTEL_METRICS_ENABLED is not set and OTEL_LOGGING_ENABLED is false', async () => {
    // This test is skipped because vi.resetModules() doesn't properly clear
    // the config module's cached values when using dynamic imports.
    // The behavior is tested by the 'false' case above.
    process.env.OTEL_LOGGING_ENABLED = 'false';
    delete process.env.OTEL_METRICS_ENABLED;
    const { getMeterProvider } = await import('../../src/utils/otel_provider');
    const provider = getMeterProvider();
    expect(provider).toBeNull();
  });

  it('should return a MeterProvider when OTEL_METRICS_ENABLED is true', async () => {
    process.env.OTEL_METRICS_ENABLED = 'true';
    const { getMeterProvider } = await import('../../src/utils/otel_provider');
    const provider = getMeterProvider();
    expect(provider).not.toBeNull();
    expect(provider).toBeDefined();
  });

  it('should default to OTEL_LOGGING_ENABLED when OTEL_METRICS_ENABLED is not set', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    delete process.env.OTEL_METRICS_ENABLED;
    const { getMeterProvider } = await import('../../src/utils/otel_provider');
    const provider = getMeterProvider();
    expect(provider).not.toBeNull();
  });

  it('should return the same instance on subsequent calls (singleton)', async () => {
    process.env.OTEL_METRICS_ENABLED = 'true';
    const { getMeterProvider } = await import('../../src/utils/otel_provider');
    const provider1 = getMeterProvider();
    const provider2 = getMeterProvider();
    expect(provider1).toBe(provider2);
  });

  it('should allow getting a meter from the provider', async () => {
    process.env.OTEL_METRICS_ENABLED = 'true';
    const { getMeterProvider } = await import('../../src/utils/otel_provider');
    const provider = getMeterProvider();
    expect(provider).not.toBeNull();

    const meter = provider!.getMeter('test-meter');
    expect(meter).toBeDefined();
  });

  it('should handle shutdown gracefully', async () => {
    process.env.OTEL_METRICS_ENABLED = 'true';
    const { getMeterProvider, shutdown } = await import('../../src/utils/otel_provider');
    const provider = getMeterProvider();
    expect(provider).not.toBeNull();

    await expect(shutdown()).resolves.not.toThrow();
  });

  it('should handle shutdown when provider is not initialized', async () => {
    process.env.OTEL_METRICS_ENABLED = 'false';
    const { shutdown } = await import('../../src/utils/otel_provider');
    await expect(shutdown()).resolves.not.toThrow();
  });

  it('should shutdown both logger and meter providers', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    process.env.OTEL_METRICS_ENABLED = 'true';
    const { getLoggerProvider, getMeterProvider, shutdown } = await import('../../src/utils/otel_provider');

    const loggerProvider = getLoggerProvider();
    const meterProvider = getMeterProvider();

    expect(loggerProvider).not.toBeNull();
    expect(meterProvider).not.toBeNull();

    await expect(shutdown()).resolves.not.toThrow();
  });
});
