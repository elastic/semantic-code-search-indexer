import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/integration/**',
      // Exclude old indexer_worker tests (has memory issues, replaced by backpressure tests)
      'tests/indexer_worker.test.ts',
    ],
    // Pool configuration
    pool: 'forks', // Use forks for better isolation
    fileParallelism: false, // Run tests serially
    maxWorkers: 1, // Single worker
    // Test timeouts
    testTimeout: 30000, // 30 second timeout per test
    hookTimeout: 30000, // 30 second timeout for hooks
    // Vitest 4.x auto-cleanup features
    mockReset: true, // Auto-reset mocks between tests
    restoreMocks: true, // Auto-restore mocks after tests
    clearMocks: true, // Auto-clear mock history between tests
    // Coverage config
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/**', 'dist/**', 'tests/**', '**/*.test.ts', '**/*.config.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
