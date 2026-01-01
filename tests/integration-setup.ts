// Integration test setup
// Set NODE_ENV before any imports so config.ts loads .env.test
process.env.NODE_ENV = 'test';

// Ensure integration tests always talk to the local Docker Elasticsearch, even if the developer
// shell has Cloud env vars set (those would otherwise route the client to Elastic Cloud).
delete process.env.ELASTICSEARCH_CLOUD_ID;
delete process.env.ELASTICSEARCH_API_KEY;

// Import afterAll before setting FORCE_LOGGING
import { afterAll } from 'vitest';

// Enable logging even in test mode for integration tests
process.env.FORCE_LOGGING = 'true';

// Keep integration tests deterministic and exercise multi-batch behavior by default.
// The default of 10 is conservative: it exercises multi-batch code paths without making the suite
// too slow or too bursty for local Docker Elasticsearch.
// Override by setting BATCH_SIZE in the environment when higher throughput is acceptable.
process.env.BATCH_SIZE = process.env.BATCH_SIZE || '10';

import { getClient } from '../src/utils/elasticsearch';

// Clean up Elasticsearch client after all tests complete
afterAll(async () => {
  try {
    await getClient().close();
  } catch {
    // Ignore errors during cleanup
  }
});
