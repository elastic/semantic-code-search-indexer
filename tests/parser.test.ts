// tests/parser.test.ts
import { LanguageParser } from '../src/utils/parser';
import { CodeChunk } from '../src/utils/elasticsearch';
import path from 'path';
import { indexingConfig } from '../src/config';

const MOCK_TIMESTAMP = '[TIMESTAMP]';

describe('LanguageParser', () => {
  let parser: LanguageParser;

  beforeAll(() => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript,javascript,markdown,yaml,java,go,python,json,gradle,properties,text';
    parser = new LanguageParser();
  });

  const cleanTimestamps = (chunks: CodeChunk[]) => {
    return chunks.map(chunk => ({
      ...chunk,
      created_at: MOCK_TIMESTAMP,
      updated_at: MOCK_TIMESTAMP,
    }));
  };

  it('should parse TypeScript usage fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/usage.ts');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/usage.ts');
    const allSymbols = chunks.flatMap(chunk => chunk.symbols);
    expect(allSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'sayHello', kind: 'function.name' }),
        expect.objectContaining({ name: 'sayHello', kind: 'function.call' }),
        expect.objectContaining({ name: 'MyClass', kind: 'class.name' }),
        expect.objectContaining({ name: 'constructor', kind: 'method.name' }),
        expect.objectContaining({ name: 'instance', kind: 'variable.name' }),
        expect.objectContaining({ name: 'MyClass', kind: 'class.instantiation' }),
        expect.objectContaining({ name: 'myVar', kind: 'variable.name' }),
        expect.objectContaining({ name: 'anotherVar', kind: 'variable.name' }),
        expect.objectContaining({ name: 'myVar', kind: 'variable.usage' }),
      ])
    );
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

  it('should parse JSON fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/json.json');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/json.json');
    expect(cleanTimestamps(chunks)).toMatchSnapshot();
  });

  it('should parse Gradle fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/gradle.gradle');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/gradle.gradle');
    expect(cleanTimestamps(chunks)).toMatchSnapshot();
  });

  it('should parse Properties fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/properties.properties');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/properties.properties');
    expect(cleanTimestamps(chunks)).toMatchSnapshot();
  });

  it('should extract symbols from Properties fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/properties.properties');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/properties.properties');
    const allSymbols = chunks.flatMap(chunk => chunk.symbols);
    expect(allSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'key', kind: 'property.key' }),
        expect.objectContaining({ name: 'value', kind: 'property.value' }),
      ])
    );
  });

  it('should parse Text fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/text.txt');
    const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/text.txt');
    expect(cleanTimestamps(chunks)).toMatchSnapshot();
  });

  it('should filter out chunks larger than maxChunkSizeBytes', () => {
    const filePath = path.resolve(__dirname, 'fixtures/large_file.json');
    const originalMaxChunkSizeBytes = indexingConfig.maxChunkSizeBytes;
    indexingConfig.maxChunkSizeBytes = 50;

    try {
      const chunks = parser.parseFile(filePath, 'main', 'tests/fixtures/large_file.json');
      expect(chunks.length).toBe(0);
    } finally {
      indexingConfig.maxChunkSizeBytes = originalMaxChunkSizeBytes;
    }
  });
});