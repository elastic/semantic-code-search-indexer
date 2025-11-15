// tests/config.test.ts
describe('elasticsearchConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('inferenceId configuration', () => {
    it('uses ELASTICSEARCH_INFERENCE_ID when set', async () => {
      process.env.ELASTICSEARCH_INFERENCE_ID = 'custom-inference-id';
      const { elasticsearchConfig } = await import('../src/config');

      expect(elasticsearchConfig.inferenceId).toBe('custom-inference-id');
    });

    it('falls back to ELASTICSEARCH_MODEL when ELASTICSEARCH_INFERENCE_ID is not set', async () => {
      delete process.env.ELASTICSEARCH_INFERENCE_ID;
      process.env.ELASTICSEARCH_MODEL = 'custom-model-id';
      const { elasticsearchConfig } = await import('../src/config');

      expect(elasticsearchConfig.inferenceId).toBe('custom-model-id');
    });

    it('uses ELASTICSEARCH_INFERENCE_ID over ELASTICSEARCH_MODEL when both are set', async () => {
      process.env.ELASTICSEARCH_INFERENCE_ID = 'new-inference-id';
      process.env.ELASTICSEARCH_MODEL = 'old-model-id';
      const { elasticsearchConfig } = await import('../src/config');

      expect(elasticsearchConfig.inferenceId).toBe('new-inference-id');
    });

    it('defaults to .elser-2-elasticsearch when neither is set', async () => {
      delete process.env.ELASTICSEARCH_INFERENCE_ID;
      delete process.env.ELASTICSEARCH_MODEL;
      const { elasticsearchConfig } = await import('../src/config');

      expect(elasticsearchConfig.inferenceId).toBe('.elser-2-elasticsearch');
    });
  });
});
