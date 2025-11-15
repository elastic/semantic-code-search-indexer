// tests/language_validator.test.ts
import { validateLanguageConfiguration, validateLanguageConfigurations } from '../src/utils/language_validator';
import { LanguageConfiguration } from '../src/utils/parser';

describe('validateLanguageConfiguration', () => {
  const validConfig: LanguageConfiguration = {
    name: 'test_language',
    fileSuffixes: ['.test'],
    parser: null,
    queries: [],
  };

  const existingConfigs: LanguageConfiguration[] = [
    {
      name: 'existing_language',
      fileSuffixes: ['.existing'],
      parser: null,
      queries: [],
    },
  ];

  describe('name validation', () => {
    it('should pass for valid lowercase name', () => {
      const errors = validateLanguageConfiguration(validConfig, existingConfigs);
      expect(errors).toEqual([]);
    });

    it('should fail when name is missing', () => {
      const config = { ...validConfig, name: '' };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toContainEqual({
        field: 'name',
        message: 'Language name is required',
      });
    });

    it('should fail when name starts with uppercase', () => {
      const config = { ...validConfig, name: 'TestLanguage' };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toContainEqual({
        field: 'name',
        message: 'Name must be lowercase alphanumeric with underscores, starting with a letter',
      });
    });

    it('should fail when name contains spaces', () => {
      const config = { ...validConfig, name: 'test language' };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toContainEqual({
        field: 'name',
        message: 'Name must be lowercase alphanumeric with underscores, starting with a letter',
      });
    });

    it('should fail when name starts with number', () => {
      const config = { ...validConfig, name: '1test' };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toContainEqual({
        field: 'name',
        message: 'Name must be lowercase alphanumeric with underscores, starting with a letter',
      });
    });

    it('should pass for name with underscores', () => {
      const config = { ...validConfig, name: 'test_language_v2' };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toEqual([]);
    });

    it('should pass for name with numbers', () => {
      const config = { ...validConfig, name: 'test2' };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toEqual([]);
    });
  });

  describe('fileSuffixes validation', () => {
    it('should fail when fileSuffixes is empty array', () => {
      const config = { ...validConfig, fileSuffixes: [] };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toContainEqual({
        field: 'fileSuffixes',
        message: 'At least one file extension is required',
      });
    });

    it('should fail when fileSuffixes is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = { ...validConfig, fileSuffixes: undefined as any };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toContainEqual({
        field: 'fileSuffixes',
        message: 'At least one file extension is required',
      });
    });

    it('should fail when extension does not start with dot', () => {
      const config = { ...validConfig, fileSuffixes: ['test'] };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toContainEqual({
        field: 'fileSuffixes[0]',
        message: 'File extension "test" must start with a dot (e.g., ".ts")',
      });
    });

    it('should fail when extension is too short', () => {
      const config = { ...validConfig, fileSuffixes: ['.'] };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toContainEqual({
        field: 'fileSuffixes[0]',
        message: 'File extension "." is too short (must be at least 2 characters)',
      });
    });

    it('should pass for multiple valid extensions', () => {
      const config = { ...validConfig, fileSuffixes: ['.test', '.tst'] };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toEqual([]);
    });

    it('should detect duplicate extensions across languages', () => {
      const config = { ...validConfig, fileSuffixes: ['.existing'] };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toContainEqual({
        field: 'fileSuffixes',
        message: 'File extension(s) .existing already used by language "existing_language"',
      });
    });

    it('should detect multiple duplicate extensions', () => {
      const existingWithMultiple: LanguageConfiguration[] = [
        {
          name: 'existing_language',
          fileSuffixes: ['.ext1', '.ext2'],
          parser: null,
          queries: [],
        },
      ];
      const config = { ...validConfig, fileSuffixes: ['.ext1', '.ext2'] };
      const errors = validateLanguageConfiguration(config, existingWithMultiple);
      expect(errors).toContainEqual({
        field: 'fileSuffixes',
        message: 'File extension(s) .ext1, .ext2 already used by language "existing_language"',
      });
    });

    it('should not report duplicates when comparing with itself', () => {
      const configs = [validConfig];
      const errors = validateLanguageConfiguration(validConfig, configs);
      // Should not have duplicate errors when checking against itself
      const duplicateErrors = errors.filter((e) => e.message.includes('already used'));
      expect(duplicateErrors).toEqual([]);
    });
  });

  describe('parser validation', () => {
    it('should pass when parser is null (custom parser)', () => {
      const config = { ...validConfig, parser: null };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toEqual([]);
    });

    it('should fail when parser is undefined', () => {
      const config = { ...validConfig, parser: undefined };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toContainEqual({
        field: 'parser',
        message: 'Parser field is required (use null for custom parsers)',
      });
    });
  });

  describe('queries validation with tree-sitter parser', () => {
    it('should pass for valid configurations without tree-sitter parser', () => {
      const config = { ...validConfig, parser: null, queries: [] };
      const errors = validateLanguageConfiguration(config, existingConfigs);
      expect(errors).toEqual([]);
    });

    // Note: Full query validation requires actual tree-sitter parser
    // which is not easy to mock. The validator catches query syntax errors
    // when a real parser is provided.
  });
});

describe('validateLanguageConfigurations', () => {
  it('should return empty object when all configurations are valid', () => {
    const configs = {
      lang1: {
        name: 'lang1',
        fileSuffixes: ['.l1'],
        parser: null,
        queries: [],
      },
      lang2: {
        name: 'lang2',
        fileSuffixes: ['.l2'],
        parser: null,
        queries: [],
      },
    };
    const results = validateLanguageConfigurations(configs);
    expect(results).toEqual({});
  });

  it('should return errors for invalid configurations', () => {
    const configs = {
      invalid1: {
        name: 'Invalid1', // Should be lowercase
        fileSuffixes: ['.i1'],
        parser: null,
        queries: [],
      },
      invalid2: {
        name: 'invalid2',
        fileSuffixes: [], // Empty array
        parser: null,
        queries: [],
      },
    };
    const results = validateLanguageConfigurations(configs);

    expect(Object.keys(results)).toEqual(expect.arrayContaining(['invalid1', 'invalid2']));
    expect(results.invalid1).toBeDefined();
    expect(results.invalid2).toBeDefined();
  });

  it('should detect conflicts between multiple configurations', () => {
    const configs = {
      lang1: {
        name: 'lang1',
        fileSuffixes: ['.shared'],
        parser: null,
        queries: [],
      },
      lang2: {
        name: 'lang2',
        fileSuffixes: ['.shared'], // Duplicate extension
        parser: null,
        queries: [],
      },
    };
    const results = validateLanguageConfigurations(configs);

    // At least one should have an error about duplicate extensions
    const hasConflict = Object.values(results).some((errors) => errors.some((e) => e.message.includes('already used')));
    expect(hasConflict).toBe(true);
  });

  it('should handle empty configurations object', () => {
    const results = validateLanguageConfigurations({});
    expect(results).toEqual({});
  });
});
