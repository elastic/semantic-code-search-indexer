import { LanguageParser } from '../../src/utils/parser';
import { logger } from '../../src/utils/logger';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn().mockReturnValue({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../src/languages', async () => {
  const actual = await vi.importActual<typeof import('../../src/languages')>('../../src/languages');
  const mockConfigs = {
    ...actual.languageConfigurations,
    conflict_js_lang: {
      name: 'conflict_js_lang',
      fileSuffixes: ['.js'], // Conflicts with javascript
      parser: null,
      queries: [],
    },
    conflict_h_lang: {
      name: 'conflict_h_lang',
      fileSuffixes: ['.h'], // Conflicts with c/cpp, but only c<->cpp should be allowed
      parser: null,
      queries: [],
    },
  };
  return {
    ...actual,
    languageConfigurations: mockConfigs,
    parseLanguageNames: vi.fn((languagesEnv?: string) => {
      if (languagesEnv === 'javascript,conflict_js_lang') {
        return ['javascript', 'conflict_js_lang'];
      }
      if (languagesEnv === 'c,conflict_h_lang') {
        return ['c', 'conflict_h_lang'];
      }
      const languageString = languagesEnv || Object.keys(mockConfigs).join(',');
      return languageString
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name in mockConfigs);
    }),
  };
});

describe('LanguageParser Extension Conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SHOULD not warn when .h is registered to both c and cpp', () => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'c,cpp';
    new LanguageParser();

    // Verify no warning was logged for .h
    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const hWarning = warnCalls.find((call: unknown[]) =>
      (call[0] as string).includes('File extension ".h" is registered to both')
    );

    expect(hWarning).toBeUndefined();
  });

  it('SHOULD still warn when .h is registered to c and a non-allowed language', () => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'c,conflict_h_lang';
    new LanguageParser();

    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const hWarning = warnCalls.find((call: unknown[]) =>
      (call[0] as string).includes('File extension ".h" is registered to both')
    );

    expect(hWarning).toBeDefined();
    expect(hWarning?.[0]).toContain('File extension ".h" is registered to both "c" and "conflict_h_lang"');
  });

  it('SHOULD still warn for other duplicate extensions', () => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'javascript,conflict_js_lang';
    new LanguageParser();

    // Verify warning was logged for .js
    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const jsWarning = warnCalls.find((call: unknown[]) =>
      (call[0] as string).includes('File extension ".js" is registered to both')
    );

    expect(jsWarning).toBeDefined();
    expect(jsWarning?.[0]).toContain('File extension ".js" is registered to both "javascript" and "conflict_js_lang"');
  });
});
