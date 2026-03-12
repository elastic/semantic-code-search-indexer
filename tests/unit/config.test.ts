import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { withTestEnv } from './utils/test_env';

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
    it('uses SCSI_ELASTICSEARCH_INFERENCE_ID when set', () =>
      withTestEnv({ SCSI_ELASTICSEARCH_INFERENCE_ID: 'custom-inference-id' }, async () => {
        const { elasticsearchConfig } = await import('../../src/config');
        expect(elasticsearchConfig.inferenceId).toBe('custom-inference-id');
      }));

    it('is undefined when SCSI_ELASTICSEARCH_INFERENCE_ID is not set', async () => {
      const { elasticsearchConfig } = await import('../../src/config');
      // Delete after import — dotenv re-runs on fresh import and sets the value from .env.test
      delete process.env.SCSI_ELASTICSEARCH_INFERENCE_ID;
      expect(elasticsearchConfig.inferenceId).toBeUndefined();
    });
  });
});
