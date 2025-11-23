import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts'],
    exclude: [
      'tests/integration/**',
      // Integration tests are run separately via npm run test:integration
    ],
    // Pool configuration
    pool: 'threads', // Use threads instead of forks for better memory efficiency
    // Run tests in parallel locally for speed, serially in CI for stability
    fileParallelism: process.env.CI ? false : true,
    maxWorkers: process.env.CI ? 1 : undefined, // Single worker in CI, auto-detect locally
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
