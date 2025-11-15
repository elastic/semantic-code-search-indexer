// tests/metrics.test.ts
import { createMetrics, createAttributes } from '../src/utils/metrics';

describe('Metrics', () => {
  describe('basic functionality', () => {
    it('should not throw when OTel is disabled', () => {
      const metrics = createMetrics();

      expect(() => {
        metrics.parser?.filesProcessed.add(1);
        metrics.queue?.documentsEnqueued.add(5);
        metrics.indexer?.batchProcessed.add(1);
      }).not.toThrow();
    });

    it('should accept repository context', () => {
      // When OTel is disabled, repoInfo may not be stored, but it shouldn't throw
      expect(() => {
        const metrics = createMetrics({ name: 'kibana', branch: 'main' });
        // Just verify it doesn't throw
        expect(metrics).toBeDefined();
      }).not.toThrow();
    });

    it('should work without repository context', () => {
      expect(() => {
        const metrics = createMetrics();
        expect(metrics).toBeDefined();
      }).not.toThrow();
    });
  });

  describe('createAttributes helper', () => {
    it('should handle custom attributes', () => {
      const metrics = createMetrics({ name: 'test-repo', branch: 'test-branch' });
      const attributes = createAttributes(metrics, {
        language: 'javascript',
        status: 'success',
        count: 42,
      });

      // Attributes should always include custom values
      expect(attributes['language']).toBe('javascript');
      expect(attributes['status']).toBe('success');
      expect(attributes['count']).toBe(42);

      // Repo context may be included if metrics are enabled
      // but should at least not throw
      expect(attributes).toBeDefined();
    });

    it('should work with empty custom attributes', () => {
      const metrics = createMetrics({ name: 'repo', branch: 'branch' });
      const attributes = createAttributes(metrics, {});

      // Should not throw
      expect(attributes).toBeDefined();
    });

    it('should work without repo context', () => {
      const metrics = createMetrics();
      const attributes = createAttributes(metrics, { custom: 'value' });

      expect(attributes['custom']).toBe('value');
    });
  });
});
