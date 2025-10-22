// tests/languages.test.ts
import { parseLanguageNames, languageConfigurations, LanguageName } from '../src/languages';

describe('parseLanguageNames', () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('should return all languages when no argument is provided', () => {
    const result = parseLanguageNames();
    const expected = Object.keys(languageConfigurations) as LanguageName[];
    expect(result).toEqual(expected);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should return all languages when empty string is provided', () => {
    const result = parseLanguageNames('');
    const expected = Object.keys(languageConfigurations) as LanguageName[];
    expect(result).toEqual(expected);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should parse valid single language', () => {
    const result = parseLanguageNames('typescript');
    expect(result).toEqual(['typescript']);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should parse multiple valid languages', () => {
    const result = parseLanguageNames('typescript,javascript,python');
    expect(result).toEqual(['typescript', 'javascript', 'python']);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should trim whitespace from language names', () => {
    const result = parseLanguageNames('  typescript  ,  javascript  ,  python  ');
    expect(result).toEqual(['typescript', 'javascript', 'python']);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should filter out invalid language names and log warning', () => {
    const result = parseLanguageNames('typescript,invalid,javascript,badlang');
    expect(result).toEqual(['typescript', 'javascript']);
    expect(consoleWarnSpy).toHaveBeenCalledWith('Invalid language names ignored: invalid, badlang');
  });

  it('should handle only invalid language names', () => {
    const result = parseLanguageNames('invalid1,invalid2');
    expect(result).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledWith('Invalid language names ignored: invalid1, invalid2');
  });

  it('should filter out empty strings after trimming', () => {
    const result = parseLanguageNames('typescript, , ,javascript');
    expect(result).toEqual(['typescript', 'javascript']);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should handle mixed valid, invalid, and empty entries', () => {
    const result = parseLanguageNames('typescript, invalid, ,javascript, badlang');
    expect(result).toEqual(['typescript', 'javascript']);
    expect(consoleWarnSpy).toHaveBeenCalledWith('Invalid language names ignored: invalid, badlang');
  });

  it('should preserve order of valid languages', () => {
    const result = parseLanguageNames('python,typescript,javascript');
    expect(result).toEqual(['python', 'typescript', 'javascript']);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should handle duplicate valid language names', () => {
    const result = parseLanguageNames('typescript,javascript,typescript');
    expect(result).toEqual(['typescript', 'javascript', 'typescript']);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should handle all supported languages', () => {
    const allLanguages = Object.keys(languageConfigurations).join(',');
    const result = parseLanguageNames(allLanguages);
    expect(result).toEqual(Object.keys(languageConfigurations));
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should parse handlebars language', () => {
    const result = parseLanguageNames('handlebars');
    expect(result).toEqual(['handlebars']);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should include handlebars in supported languages', () => {
    const allLanguages = Object.keys(languageConfigurations);
    expect(allLanguages).toContain('handlebars');
  });
});

