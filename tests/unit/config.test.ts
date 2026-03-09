import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

describe('elasticsearchConfig', () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('inferenceId configuration', () => {
    it('uses SCSI_ELASTICSEARCH_INFERENCE_ID when set', async () => {
      process.env.SCSI_ELASTICSEARCH_INFERENCE_ID = 'custom-inference-id';
      const { elasticsearchConfig } = await import('../../src/config');

      expect(elasticsearchConfig.inferenceId).toBe('custom-inference-id');
    });

    it('is undefined when SCSI_ELASTICSEARCH_INFERENCE_ID is not set', async () => {
      const { elasticsearchConfig } = await import('../../src/config');
      // Delete after import, so we remove the value that dotenv loaded from .env.test
      delete process.env.SCSI_ELASTICSEARCH_INFERENCE_ID;

      expect(elasticsearchConfig.inferenceId).toBeUndefined();
    });
  });
});
