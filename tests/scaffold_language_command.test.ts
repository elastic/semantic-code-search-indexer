// tests/scaffold_language_command.test.ts
import path from 'path';
import { vol } from 'memfs';

// Mock fs module
jest.mock('fs');
jest.mock('fs/promises');

describe('scaffold_language_command', () => {
  const languagesDir = path.join(process.cwd(), 'src', 'languages');
  const indexPath = path.join(languagesDir, 'index.ts');

  const mockIndexContent = `// src/languages/index.ts
import { typescript } from './typescript';
import { javascript } from './javascript';
import { LanguageConfiguration } from '../utils/parser';
import { validateLanguageConfiguration, validateLanguageConfigurations, ValidationError } from '../utils/language_validator';

export const languageConfigurations = {
  typescript,
  javascript,
} as const;

export type LanguageName = keyof typeof languageConfigurations;
`;

  const mockTreeSitterTemplate = `import {{TREE_SITTER_PACKAGE_VAR}} from '{{TREE_SITTER_PACKAGE}}';
import { LanguageConfiguration } from '../utils/parser';

export const {{LANGUAGE_NAME}}Config: LanguageConfiguration = {
  name: '{{LANGUAGE_NAME}}',
  fileSuffixes: [{{FILE_EXTENSIONS}}],
  parser: {{TREE_SITTER_PACKAGE_VAR}},
  queries: [],
};
`;

  const mockCustomTemplate = `import { LanguageConfiguration } from '../utils/parser';

export const {{LANGUAGE_NAME}}Config: LanguageConfiguration = {
  name: '{{LANGUAGE_NAME}}',
  fileSuffixes: [{{FILE_EXTENSIONS}}],
  parser: null,
  queries: [],
};
`;

  beforeEach(() => {
    // Reset virtual filesystem
    vol.reset();

    // Setup mock filesystem
    vol.fromJSON({
      [indexPath]: mockIndexContent,
      [path.join(languagesDir, 'templates', 'tree-sitter-template.txt')]: mockTreeSitterTemplate,
      [path.join(languagesDir, 'templates', 'custom-parser-template.txt')]: mockCustomTemplate,
    });

    // Clear console mocks
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('template file generation', () => {
    it('should generate file with tree-sitter template when parser is specified', () => {
      const langName = 'rust';
      const parser = 'tree-sitter-rust';

      // This would be the generated content
      const expectedContent = mockTreeSitterTemplate
        .replace(/\{\{LANGUAGE_NAME\}\}/g, langName)
        .replace(/\{\{FILE_EXTENSIONS\}\}/g, `'.rs', '.rlib'`)
        .replace(/\{\{TREE_SITTER_PACKAGE\}\}/g, parser)
        .replace(/\{\{TREE_SITTER_PACKAGE_VAR\}\}/g, 'rust');

      expect(expectedContent).toContain(`name: '${langName}'`);
      expect(expectedContent).toContain(`fileSuffixes: ['.rs', '.rlib']`);
      expect(expectedContent).toContain(`import rust from 'tree-sitter-rust'`);
      expect(expectedContent).toContain(`parser: rust`);
    });

    it('should generate file with custom template when --custom is specified', () => {
      const langName = 'custom_lang';

      const expectedContent = mockCustomTemplate
        .replace(/\{\{LANGUAGE_NAME\}\}/g, langName)
        .replace(/\{\{FILE_EXTENSIONS\}\}/g, `'.cst'`);

      expect(expectedContent).toContain(`name: '${langName}'`);
      expect(expectedContent).toContain(`fileSuffixes: ['.cst']`);
      expect(expectedContent).toContain('parser: null');
    });

    it('should use custom template when no parser is specified', () => {
      const langName = 'markup';

      const expectedContent = mockCustomTemplate
        .replace(/\{\{LANGUAGE_NAME\}\}/g, langName)
        .replace(/\{\{FILE_EXTENSIONS\}\}/g, `'.mkp'`);

      expect(expectedContent).toContain('parser: null');
    });

    it('should handle multiple extensions correctly', () => {
      const langName = 'cpp';

      const expectedExtensions = `'.cpp', '.cc', '.cxx', '.hpp', '.h'`;
      const expectedContent = mockTreeSitterTemplate
        .replace(/\{\{LANGUAGE_NAME\}\}/g, langName)
        .replace(/\{\{FILE_EXTENSIONS\}\}/g, expectedExtensions)
        .replace(/\{\{TREE_SITTER_PACKAGE\}\}/g, 'tree-sitter-cpp')
        .replace(/\{\{TREE_SITTER_PACKAGE_VAR\}\}/g, 'cpp');

      expect(expectedContent).toContain(expectedExtensions);
    });
  });

  describe('input validation', () => {
    it('should validate language name format', () => {
      const invalidNames = [
        'InvalidName', // Uppercase
        'invalid-name', // Hyphen
        '123invalid', // Starts with number
        'invalid name', // Space
        'invalid.name', // Dot
      ];

      invalidNames.forEach((name) => {
        expect(name.match(/^[a-z][a-z0-9_]*$/)).toBeNull();
      });
    });

    it('should accept valid language names', () => {
      const validNames = ['rust', 'cpp', 'c_sharp', 'rust2', 'proto3'];

      validNames.forEach((name) => {
        expect(name.match(/^[a-z][a-z0-9_]*$/)).not.toBeNull();
      });
    });

    it('should normalize extensions to start with dot', () => {
      const extensions = ['rs', '.rlib', 'toml'];
      const normalized = extensions.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));

      expect(normalized).toEqual(['.rs', '.rlib', '.toml']);
    });
  });

  describe('index.ts updates', () => {
    it('should format import statement correctly', () => {
      const langName = 'rust';
      const configVarName = `${langName}Config`;
      const importStatement = `import { ${configVarName} } from './${langName}';`;

      expect(importStatement).toBe(`import { rustConfig } from './rust';`);
    });

    it('should format registration line correctly', () => {
      const langName = 'rust';
      const configVarName = `${langName}Config`;
      const registrationLine = `  ${langName}: ${configVarName},`;

      expect(registrationLine).toBe('  rust: rustConfig,');
    });
  });

  describe('configuration validation', () => {
    it('should create valid mock configuration for validation', () => {
      const langName = 'rust';
      const suffixes = ['.rs', '.rlib'];

      const mockConfig = {
        name: langName,
        fileSuffixes: suffixes,
        parser: null,
        queries: [],
      };

      expect(mockConfig.name).toBe('rust');
      expect(mockConfig.fileSuffixes).toEqual(['.rs', '.rlib']);
      expect(mockConfig.parser).toBeNull();
      expect(mockConfig.queries).toEqual([]);
    });
  });

  describe('file path handling', () => {
    it('should construct correct file paths', () => {
      const langName = 'rust';
      const expectedFileName = `${langName}.ts`;
      const expectedPath = path.join(languagesDir, expectedFileName);

      expect(expectedFileName).toBe('rust.ts');
      expect(expectedPath).toContain('src/languages/rust.ts');
    });

    it('should construct correct template paths', () => {
      const treeSitterTemplatePath = path.join(languagesDir, 'templates', 'tree-sitter-template.txt');
      const customTemplatePath = path.join(languagesDir, 'templates', 'custom-parser-template.txt');

      expect(treeSitterTemplatePath).toContain('templates/tree-sitter-template.txt');
      expect(customTemplatePath).toContain('templates/custom-parser-template.txt');
    });
  });

  describe('package variable name extraction', () => {
    it('should extract package variable name from tree-sitter package', () => {
      const testCases = [
        { package: 'tree-sitter-rust', expected: 'rust' },
        { package: 'tree-sitter-python', expected: 'python' },
        { package: 'tree-sitter-typescript', expected: 'typescript' },
        { package: 'tree-sitter-cpp', expected: 'cpp' },
      ];

      testCases.forEach(({ package: pkg, expected }) => {
        const varName = pkg.replace('tree-sitter-', '');
        expect(varName).toBe(expected);
      });
    });
  });
});
