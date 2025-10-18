// tests/otel_provider.test.ts

describe('OTel Provider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clear the module cache to ensure fresh imports
    jest.resetModules();
    process.env = { ...originalEnv };
    // Ensure NODE_ENV is not 'test' for these tests
    delete process.env.NODE_ENV;
  });

  afterEach(async () => {
    process.env = originalEnv;
    // Dynamically import and shutdown
    const { shutdown } = await import('../src/utils/otel_provider');
    await shutdown();
  });

  it('should return null when OTEL_LOGGING_ENABLED is not true', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'false';
    const { getLoggerProvider } = await import('../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).toBeNull();
  });

  it('should return null when OTEL_LOGGING_ENABLED is not set', async () => {
    delete process.env.OTEL_LOGGING_ENABLED;
    const { getLoggerProvider } = await import('../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).toBeNull();
  });

  it('should return a LoggerProvider when OTEL_LOGGING_ENABLED is true', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider } = await import('../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();
    expect(provider).toBeDefined();
  });

  it('should return the same instance on subsequent calls (singleton)', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider } = await import('../src/utils/otel_provider');
    const provider1 = getLoggerProvider();
    const provider2 = getLoggerProvider();
    expect(provider1).toBe(provider2);
  });

  it('should use OTEL_SERVICE_NAME if provided', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    process.env.OTEL_SERVICE_NAME = 'custom-service-name';
    const { getLoggerProvider } = await import('../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();
    // Resource attributes are internal, so we just verify the provider is created
  });

  it('should use default service name if OTEL_SERVICE_NAME is not set', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    delete process.env.OTEL_SERVICE_NAME;
    const { getLoggerProvider } = await import('../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();
  });

  it('should allow getting a logger from the provider', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider } = await import('../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();
    
    const logger = provider!.getLogger('test-logger');
    expect(logger).toBeDefined();
    expect(logger.emit).toBeDefined();
  });

  it('should handle shutdown gracefully', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider, shutdown } = await import('../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();
    
    await expect(shutdown()).resolves.not.toThrow();
  });

  it('should handle shutdown when provider is not initialized', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'false';
    const { shutdown } = await import('../src/utils/otel_provider');
    await expect(shutdown()).resolves.not.toThrow();
  });

  it('should not include git.indexer.* resource attributes', async () => {
    process.env.OTEL_LOGGING_ENABLED = 'true';
    const { getLoggerProvider } = await import('../src/utils/otel_provider');
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
    const { getLoggerProvider } = await import('../src/utils/otel_provider');
    const provider = getLoggerProvider();
    expect(provider).not.toBeNull();
    
    // Access the resource attributes through the provider's _sharedState
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resource = (provider as any)._sharedState.resource;
    const attributes = resource.attributes;
    
    // Verify standard attributes are still present
    expect(attributes['service.name']).toBeDefined();
    expect(attributes['host.name']).toBeDefined();
    expect(attributes['host.arch']).toBeDefined();
  });
});
