// tests/parser.test.ts
import { LanguageParser } from '../src/utils/parser';
import path from 'path';

const MOCK_TIMESTAMP = '[TIMESTAMP]';

describe('LanguageParser', () => {
  let parser: LanguageParser;

  beforeAll(() => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript,javascript,markdown,yaml,java,go,python';
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
    const symbols = chunks[0].symbols;
    expect(symbols).toContain('myFunction');
    expect(symbols).toContain('MyClass');
    expect(symbols).toContain('myMethod');
    expect(symbols).toContain('myVar');
    expect(symbols).toContain('MyType');
    expect(symbols).toContain('MyInterface');
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

  it('should parse Java fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/java.java');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/java.java');
    expect(cleanTimestamps(chunks)).toMatchSnapshot();
  });

  it('should parse Go fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/go.go');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/go.go');
    expect(cleanTimestamps(chunks)).toMatchSnapshot();
  });

  it('should parse Python fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/python.py');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/python.py');
    expect(cleanTimestamps(chunks)).toMatchSnapshot();
  });
});