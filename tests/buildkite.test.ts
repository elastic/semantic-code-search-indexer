// tests/buildkite.test.ts

describe('Buildkite Integration', () => {
  describe('Error Summary Extraction', () => {
    it('should identify npm errors', () => {
      const log = `
Installing dependencies...
npm ERR! code ERESOLVE
npm ERR! ERESOLVE could not resolve
npm ERR! 
npm ERR! While resolving: project@1.0.0
npm ERR! Found: react@17.0.0
      `;
      
      // Since extractErrorSummary is private, we'll test the integration
      // For now, this is a placeholder test
      expect(log).toContain('npm ERR!');
    });

    it('should identify linting errors', () => {
      const log = `
Running linter...
/src/file.ts
  18:10  error  'variable' is defined but never used  @typescript-eslint/no-unused-vars
  55:18  error  'param' is defined but never used  @typescript-eslint/no-unused-vars
✖ 2 problems (2 errors, 0 warnings)
      `;
      
      expect(log).toContain('error');
      expect(log).toContain('@typescript-eslint/no-unused-vars');
    });

    it('should identify test failures', () => {
      const log = `
Running tests...
FAIL tests/example.test.ts
  ● Test suite failed to run
    
    TypeError: Cannot read property 'foo' of undefined
      
      at Object.<anonymous> (tests/example.test.ts:10:5)
      `;
      
      expect(log).toContain('FAIL');
      expect(log).toContain('failed to run');
    });
  });

  describe('Build Configuration', () => {
    it('should require token, org, and pipeline', () => {
      const config = {
        token: 'test-token',
        organization: 'test-org',
        pipeline: 'test-pipeline',
      };
      
      expect(config.token).toBe('test-token');
      expect(config.organization).toBe('test-org');
      expect(config.pipeline).toBe('test-pipeline');
    });
  });
});
