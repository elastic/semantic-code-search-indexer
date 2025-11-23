// Integration test setup
// Set NODE_ENV before any imports so config.ts loads .env.test
process.env.NODE_ENV = 'test';

// Import afterAll before setting FORCE_LOGGING
import { afterAll } from 'vitest';

// Enable logging even in test mode for integration tests
process.env.FORCE_LOGGING = 'true';

import { client } from '../src/utils/elasticsearch';

// Clean up Elasticsearch client after all tests complete
afterAll(async () => {
  try {
    await client.close();
  } catch {
    // Ignore errors during cleanup
  }
});
