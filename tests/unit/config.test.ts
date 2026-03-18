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
    it('uses SCS_IDXR_ELASTICSEARCH_INFERENCE_ID when set', () =>
      withTestEnv({ SCS_IDXR_ELASTICSEARCH_INFERENCE_ID: 'custom-inference-id' }, async () => {
        const { elasticsearchConfig } = await import('../../src/config');
        expect(elasticsearchConfig.inferenceId).toBe('custom-inference-id');
      }));

    it('is undefined when SCS_IDXR_ELASTICSEARCH_INFERENCE_ID is not set', async () => {
      const { elasticsearchConfig } = await import('../../src/config');
      // Delete after import — dotenv re-runs on fresh import and sets the value from .env.test
      delete process.env.SCS_IDXR_ELASTICSEARCH_INFERENCE_ID;
      expect(elasticsearchConfig.inferenceId).toBeUndefined();
    });
  });
});

describe('indexingConfig', () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when SCS_IDXR_DEFAULT_CHUNK_LINES=0 (must be positive)', () =>
    withTestEnv({ SCS_IDXR_DEFAULT_CHUNK_LINES: '0' }, async () => {
      const { indexingConfig } = await import('../../src/config');
      expect(() => indexingConfig.defaultChunkLines).toThrow(/must be a positive integer/);
    }));

  it('throws when SCS_IDXR_MAX_CHUNK_SIZE_BYTES=0 (must be positive)', () =>
    withTestEnv({ SCS_IDXR_MAX_CHUNK_SIZE_BYTES: '0' }, async () => {
      const { indexingConfig } = await import('../../src/config');
      expect(() => indexingConfig.maxChunkSizeBytes).toThrow(/must be a positive integer/);
    }));

  it('allows SCS_IDXR_CHUNK_OVERLAP_LINES=0', () =>
    withTestEnv({ SCS_IDXR_CHUNK_OVERLAP_LINES: '0' }, async () => {
      const { indexingConfig } = await import('../../src/config');
      expect(indexingConfig.chunkOverlapLines).toBe(0);
    }));

  it('allows SCS_IDXR_TEST_INDEXING_DELAY_MS=0', () =>
    withTestEnv({ SCS_IDXR_TEST_INDEXING_DELAY_MS: '0' }, async () => {
      const { indexingConfig } = await import('../../src/config');
      expect(indexingConfig.testDelayMs).toBe(0);
    }));

  it('throws when boolean config receives invalid string', () =>
    withTestEnv({ SCS_IDXR_ENABLE_DENSE_VECTORS: 'maybe' }, async () => {
      const { indexingConfig } = await import('../../src/config');
      expect(() => indexingConfig.enableDenseVectors).toThrow(/must be a boolean/);
    }));
});
