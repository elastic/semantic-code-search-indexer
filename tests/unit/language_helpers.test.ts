import { describe, it, expect } from 'vitest';
import { resolveBashImport } from '../../src/utils/language_helpers';

describe('language_helpers', () => {
  describe('resolveBashImport', () => {
    it('should return absolute paths unchanged', () => {
      const result = resolveBashImport('/usr/local/lib/utils.sh', '/home/user/project/script.sh', '/home/user/project');
      expect(result).toEqual({ path: '/usr/local/lib/utils.sh', type: 'file' });
    });

    it('should resolve relative paths to be git-root-relative', () => {
      const result = resolveBashImport('./lib/utils.sh', '/home/user/project/scripts/main.sh', '/home/user/project');
      expect(result).toEqual({ path: 'scripts/lib/utils.sh', type: 'file' });
    });

    it('should resolve bare filenames relative to file directory', () => {
      const result = resolveBashImport('utils.sh', '/home/user/project/scripts/main.sh', '/home/user/project');
      expect(result).toEqual({ path: 'scripts/utils.sh', type: 'file' });
    });

    it('should always return type "file"', () => {
      const result = resolveBashImport('some_module', '/home/user/project/script.sh', '/home/user/project');
      expect(result.type).toBe('file');
    });
  });

  // filterPythonExportsByAll and isBashExportDeclaration require actual tree-sitter
  // parsers and trees. They are tested implicitly via the parser integration tests
  // (parser.test.ts) that verify Python __all__ filtering and Bash export detection
  // produce correct results end-to-end.
});
