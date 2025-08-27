// tests/parser.test.ts
import { LanguageParser } from '../src/utils/parser';
import path from 'path';

const MOCK_TIMESTAMP = '[TIMESTAMP]';

describe('LanguageParser', () => {
  let parser: LanguageParser;

  beforeAll(() => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript,javascript,markdown,yaml';
    parser = new LanguageParser();
  });

  const cleanTimestamps = (chunks: any[]) => {
    return chunks.map(chunk => ({
      ...chunk,
      created_at: MOCK_TIMESTAMP,
      updated_at: MOCK_TIMESTAMP,
    }));
  };

  it('should parse TypeScript fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/typescript.ts');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/typescript.ts');
    expect(cleanTimestamps(chunks)).toMatchSnapshot();
  });

  it('should parse JavaScript fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/javascript.js');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/javascript.js');
    expect(cleanTimestamps(chunks)).toMatchSnapshot();
  });

  it('should parse Markdown fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/markdown.md');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/markdown.md');
    expect(cleanTimestamps(chunks)).toMatchSnapshot();
  });

  it('should parse YAML fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/yaml.yml');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/yaml.yml');
    expect(cleanTimestamps(chunks)).toMatchSnapshot();
  });
});