// Integration test setup
// Set NODE_ENV before any imports so config.ts loads .env.test
process.env.NODE_ENV = 'test';

// Ensure integration tests always talk to the local Docker Elasticsearch, even if the developer
// shell has Cloud env vars set (those would otherwise route the client to Elastic Cloud).
delete process.env.SCSI_ES_CLOUD_ID;
delete process.env.SCSI_ES_API_KEY;

// Import afterAll before setting SCSI_FORCE_LOGGING
import { afterAll } from 'vitest';

// Enable logging even in test mode for integration tests
process.env.SCSI_FORCE_LOGGING = 'true';

import { getClient } from '../src/utils/elasticsearch';

// Clean up Elasticsearch client after all tests complete
afterAll(async () => {
  try {
    await getClient().close();
  } catch {
    // Ignore errors during cleanup
  }
});
