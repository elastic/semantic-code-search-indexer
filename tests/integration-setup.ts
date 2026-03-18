// Integration test setup
// Set NODE_ENV before any imports so config.ts loads .env.test
process.env.NODE_ENV = 'test';

// Ensure integration tests always talk to the local Docker Elasticsearch, even if the developer
// shell has Cloud env vars set (those would otherwise route the client to Elastic Cloud).
// Only delete Cloud-specific vars; ELASTICSEARCH_ENDPOINT/USERNAME/PASSWORD come from .env.test
// and must survive (dotenv loads them before this code runs via config.ts import).
delete process.env.ELASTICSEARCH_CLOUD_ID;
delete process.env.ELASTICSEARCH_API_KEY;

// Import afterAll before setting SCS_IDXR_FORCE_LOGGING
import { afterAll } from 'vitest';

// Enable logging even in test mode for integration tests
process.env.SCS_IDXR_FORCE_LOGGING = 'true';

import { getClient } from '../src/utils/elasticsearch';

// Clean up Elasticsearch client after all tests complete
afterAll(async () => {
  try {
    await getClient().close();
  } catch {
    // Ignore errors during cleanup
  }
});
