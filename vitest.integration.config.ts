import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/integration-setup.ts'], // Use separate setup for integration tests
    include: ['tests/integration/**/*.test.ts'],
    // Pool configuration
    pool: 'forks', // Use forks for integration tests to ensure process-level isolation
    // Integration tests can run in parallel locally, serially in CI
    fileParallelism: process.env.CI ? false : true,
    maxWorkers: process.env.CI ? 1 : undefined, // Single worker in CI, auto-detect locally
    // Test timeouts
    testTimeout: 180000, // 3 minute timeout per test (integration tests take longer)
    hookTimeout: 30000, // 30 second timeout for hooks
    // Vitest 4.x auto-cleanup features
    mockReset: true, // Auto-reset mocks between tests
    restoreMocks: true, // Auto-restore mocks after tests
    clearMocks: true, // Auto-clear mock history between tests
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
