// tests/parser.test.ts
import { LanguageParser } from '../src/utils/parser';
import { CodeChunk } from '../src/utils/elasticsearch';
import path from 'path';
import { indexingConfig } from '../src/config';
import fs from 'fs';

const MOCK_TIMESTAMP = '[TIMESTAMP]';

describe('LanguageParser', () => {
  let parser: LanguageParser;

  beforeAll(() => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = 'typescript,javascript,markdown,yaml,java,go,python,json,gradle,properties,text,handlebars';
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
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/usage.ts');
    const allSymbols = result.chunks.flatMap(chunk => chunk.symbols);
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
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/javascript.js');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Markdown fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/markdown.md');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/markdown.md');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse YAML fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/yaml.yml');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/yaml.yml');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Java fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/java.java');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/java.java');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Go fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/go.go');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/go.go');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Python fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/python.py');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python.py');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse JSON fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/json.json');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/json.json');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Gradle fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/gradle.gradle');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/gradle.gradle');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Properties fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/properties.properties');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/properties.properties');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should extract symbols from Properties fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/properties.properties');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/properties.properties');
    const allSymbols = result.chunks.flatMap(chunk => chunk.symbols);
    expect(allSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'key', kind: 'property.key' }),
        expect.objectContaining({ name: 'value', kind: 'property.value' }),
      ])
    );
  });

  it('should parse Text fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/text.txt');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/text.txt');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Handlebars fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/handlebars.hbs');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/handlebars.hbs');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should extract content from Handlebars fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/handlebars.hbs');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/handlebars.hbs');
    
    // Verify exactly one chunk was created (whole file approach)
    expect(result.chunks.length).toBe(1);
    
    // Verify language is set correctly
    expect(result.chunks[0].language).toBe('handlebars');
    
    // Verify parser type
    expect(result.metrics.parserType).toBe('handlebars');
    
    // Verify both static content and Handlebars expressions are captured
    const content = result.chunks[0].content;
    expect(content).toContain('metricsets');
    expect(content).toContain('{{');
    expect(content).toContain('{{#each hosts}}');
    expect(content).toContain('{{path}}');
    
    // Verify line numbers span the entire file
    expect(result.chunks[0].startLine).toBe(1);
    expect(result.chunks[0].endLine).toBeGreaterThan(1);
  });

  it('should recognize .hbs file extension', () => {
    const hbsFile = path.resolve(__dirname, 'fixtures/handlebars.hbs');
    const result = parser.parseFile(hbsFile, 'main', 'tests/fixtures/handlebars.hbs');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0].language).toBe('handlebars');
  });

  it('should filter out chunks larger than maxChunkSizeBytes', () => {
    const filePath = path.resolve(__dirname, 'fixtures/large_file.json');
    const originalMaxChunkSizeBytes = indexingConfig.maxChunkSizeBytes;
    indexingConfig.maxChunkSizeBytes = 50;

    try {
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/large_file.json');
      // With the new chunking approach, JSON is split by properties
      // The small_chunk should pass, but large_chunk should be filtered out
      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].content).toContain('small_chunk');
    } finally {
      indexingConfig.maxChunkSizeBytes = originalMaxChunkSizeBytes;
    }
  });

  it('should extract directory information correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/typescript.ts');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/typescript.ts');
    
    expect(result.chunks.length).toBeGreaterThan(0);
    
    // All chunks should have directory information
    result.chunks.forEach(chunk => {
      expect(chunk.directoryPath).toBe('tests/fixtures');
      expect(chunk.directoryName).toBe('fixtures');
      expect(chunk.directoryDepth).toBe(2);
    });
  });

  it('should handle root-level files correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/typescript.ts');
    const result = parser.parseFile(filePath, 'main', 'typescript.ts');
    
    expect(result.chunks.length).toBeGreaterThan(0);
    
    // Root-level files should have empty directory path and depth 0
    result.chunks.forEach(chunk => {
      expect(chunk.directoryPath).toBe('');
      expect(chunk.directoryName).toBe('');
      expect(chunk.directoryDepth).toBe(0);
    });
  });

  it('should handle nested directory paths correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/typescript.ts');
    const result = parser.parseFile(filePath, 'main', 'src/utils/helpers/typescript.ts');
    
    expect(result.chunks.length).toBeGreaterThan(0);
    
    // Nested files should have correct directory information
    result.chunks.forEach(chunk => {
      expect(chunk.directoryPath).toBe('src/utils/helpers');
      expect(chunk.directoryName).toBe('helpers');
      expect(chunk.directoryDepth).toBe(3);
    });
  });

  describe('Line Number Calculation', () => {
    it('should calculate correct line numbers for Markdown files', () => {
      const filePath = path.resolve(__dirname, 'fixtures/markdown.md');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/markdown.md');
      
      // First chunk should start at line 1 (heading)
      expect(result.chunks[0].startLine).toBe(1);
      expect(result.chunks[0].endLine).toBe(1);
      
      // Second chunk should start at line 3 (paragraph after empty line)
      expect(result.chunks[1].startLine).toBe(3);
      expect(result.chunks[1].endLine).toBe(3);
      
      // Third chunk should start at line 5 (heading)
      expect(result.chunks[2].startLine).toBe(5);
      expect(result.chunks[2].endLine).toBe(5);
      
      // Fourth chunk should start at line 7 (paragraph)
      expect(result.chunks[3].startLine).toBe(7);
      expect(result.chunks[3].endLine).toBe(8); // Includes the newline
    });

    it('should calculate correct line numbers for YAML multi-document files', () => {
      const filePath = path.resolve(__dirname, 'fixtures/yaml.yml');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/yaml.yml');
      
      // First document chunks
      expect(result.chunks[0].startLine).toBe(1); // "document: one"
      expect(result.chunks[0].endLine).toBe(1);
      expect(result.chunks[1].startLine).toBe(2); // "pair:"
      expect(result.chunks[1].endLine).toBe(2);
      expect(result.chunks[2].startLine).toBe(3); // "  key: value"
      expect(result.chunks[2].endLine).toBe(3);
      
      // Second document chunks (after --- separator)
      expect(result.chunks[3].startLine).toBe(5); // "document: two"
      expect(result.chunks[3].endLine).toBe(5);
      expect(result.chunks[4].startLine).toBe(6); // "another_pair:"
      expect(result.chunks[4].endLine).toBe(6);
      expect(result.chunks[5].startLine).toBe(7); // "  nested_key: nested_value"
      expect(result.chunks[5].endLine).toBe(7);
    });

    it('should handle duplicate content correctly in line number calculation', () => {
      // Create a test file with duplicate content to test the fix
      const testContent = `First paragraph

Second paragraph

First paragraph

Third paragraph`;
      
      const testFilePath = path.resolve(__dirname, 'fixtures/duplicate_test.txt');
      fs.writeFileSync(testFilePath, testContent);
      
      try {
        const result = parser.parseFile(testFilePath, 'main', 'tests/fixtures/duplicate_test.txt');
        
        // Should have 4 chunks
        expect(result.chunks.length).toBe(4);
        
        // First occurrence of "First paragraph" should be at line 1
        expect(result.chunks[0].startLine).toBe(1);
        expect(result.chunks[0].content).toBe('First paragraph');
        
        // "Second paragraph" should be at line 3
        expect(result.chunks[1].startLine).toBe(3);
        expect(result.chunks[1].content).toBe('Second paragraph');
        
        // Second occurrence of "First paragraph" should be at line 5
        expect(result.chunks[2].startLine).toBe(5);
        expect(result.chunks[2].content).toBe('First paragraph');
        
        // "Third paragraph" should be at line 7
        expect(result.chunks[3].startLine).toBe(7);
        expect(result.chunks[3].content).toBe('Third paragraph');
      } finally {
        // Clean up test file
        if (fs.existsSync(testFilePath)) {
          fs.unlinkSync(testFilePath);
        }
      }
    });

    it('should calculate correct line numbers for JSON files', () => {
      const filePath = path.resolve(__dirname, 'fixtures/json.json');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/json.json');
      
      // Verify that JSON chunks have correct line numbers matching their position in the file
      expect(result.chunks.length).toBe(10);
      
      // Check first few chunks to verify line numbers are correct
      expect(result.chunks[0].content).toContain('"name"');
      expect(result.chunks[0].startLine).toBe(2); // "name" is on line 2
      
      expect(result.chunks[1].content).toContain('"version"');
      expect(result.chunks[1].startLine).toBe(3); // "version" is on line 3
      
      expect(result.chunks[2].content).toContain('"description"');
      expect(result.chunks[2].startLine).toBe(4); // "description" is on line 4
      
      expect(result.chunks[3].content).toContain('"main"');
      expect(result.chunks[3].startLine).toBe(5); // "main" is on line 5
      
      expect(result.chunks[4].content).toContain('"scripts"');
      expect(result.chunks[4].startLine).toBe(6); // "scripts" is on line 6
    });

    it('should calculate correct line numbers for text files', () => {
      const filePath = path.resolve(__dirname, 'fixtures/text.txt');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/text.txt');
      
      // Single line text file
      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].startLine).toBe(1);
      expect(result.chunks[0].endLine).toBe(1);
    });

    it('should calculate correct line numbers for repeated paragraphs', () => {
      const filePath = path.resolve(__dirname, 'fixtures/repeated_paragraphs.txt');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/repeated_paragraphs.txt');

      expect(result.chunks).toHaveLength(3);
      expect(result.chunks[0].content).toBe('Repeat me');
      expect(result.chunks[0].startLine).toBe(1);
      expect(result.chunks[0].endLine).toBe(1);

      expect(result.chunks[1].content).toBe('Repeat me');
      expect(result.chunks[1].startLine).toBe(3);
      expect(result.chunks[1].endLine).toBe(3);

      expect(result.chunks[2].content).toBe('Repeat me');
      expect(result.chunks[2].startLine).toBe(5);
      expect(result.chunks[2].endLine).toBe(5);
    });
  });

  describe('Export Detection', () => {
    it('should extract TypeScript exports correctly', () => {
      const filePath = path.resolve(__dirname, 'fixtures/typescript.ts');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/typescript.ts');
      
      const allExports = result.chunks.flatMap(chunk => chunk.exports || []);
      
      // Check that we have the expected exports
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'MyClass', type: 'named' }),
          expect.objectContaining({ name: 'myVar', type: 'named' }),
          expect.objectContaining({ name: 'MyType', type: 'named' }),
          expect.objectContaining({ name: 'MyInterface', type: 'named' }),
          expect.objectContaining({ name: 'myFunction', type: 'named' }),
          expect.objectContaining({ name: 'MyClass', type: 'default' }),
        ])
      );
    });

    it('should extract JavaScript exports correctly', () => {
      const filePath = path.resolve(__dirname, 'fixtures/javascript.js');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/javascript.js');
      
      const allExports = result.chunks.flatMap(chunk => chunk.exports || []);
      
      // Check that we have the expected exports
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'MyClass', type: 'named' }),
          expect.objectContaining({ name: 'myVar', type: 'named' }),
          expect.objectContaining({ name: 'myFunction', type: 'named' }),
          expect.objectContaining({ name: 'MyClass', type: 'default' }),
        ])
      );
    });

    it('should extract Python exports correctly', () => {
      const filePath = path.resolve(__dirname, 'fixtures/python.py');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python.py');
      
      const allExports = result.chunks.flatMap(chunk => chunk.exports || []);
      
      // Python should export top-level functions, classes, and uppercase constants
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'MyClass', type: 'named' }),
          expect.objectContaining({ name: 'my_function', type: 'named' }),
          expect.objectContaining({ name: 'MY_CONSTANT', type: 'named' }),
        ])
      );
    });

    it('should extract Java public exports correctly', () => {
      const filePath = path.resolve(__dirname, 'fixtures/java.java');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/java.java');
      
      const allExports = result.chunks.flatMap(chunk => chunk.exports || []);
      
      // Java should export public declarations
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'MyClass', type: 'named' }),
          expect.objectContaining({ name: 'myMethod', type: 'named' }),
        ])
      );
      
      // Should not export private methods
      expect(allExports).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'privateMethod' }),
        ])
      );
    });

    it('should extract Go capitalized exports correctly', () => {
      const filePath = path.resolve(__dirname, 'fixtures/go.go');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/go.go');
      
      const allExports = result.chunks.flatMap(chunk => chunk.exports || []);
      
      // Go should export capitalized identifiers
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Hello', type: 'named' }),
          expect.objectContaining({ name: 'MyType', type: 'named' }),
          expect.objectContaining({ name: 'MyConst', type: 'named' }),
        ])
      );
      
      // Should not export lowercase identifiers
      expect(allExports).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'privateFunc' }),
        ])
      );
    });

    it('should handle re-exports and mixed export styles', () => {
      const filePath = path.resolve(__dirname, 'fixtures/exports_edge_cases.ts');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/exports_edge_cases.ts');
      
      const allExports = result.chunks.flatMap(chunk => chunk.exports || []);
      
      // Should capture re-exports with aliasing (captures the alias)
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'bar', type: 'named' }),
        ])
      );
      
      // Should capture namespace re-exports
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: '*', type: 'namespace' }),
        ])
      );
      
      // Should capture named exports
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'a', type: 'named' }),
        ])
      );
      
      // Should capture default exports
      // Note: For "export default class B {}", both named and default exports are captured
      // This is expected behavior as documented in EXPORTS_IMPLEMENTATION.md
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'B', type: 'default' }),
        ])
      );
      
      // Should capture re-exported symbols
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'util', type: 'named' }),
          expect.objectContaining({ name: 'c', type: 'named' }),
          expect.objectContaining({ name: 'x', type: 'named' }),
          expect.objectContaining({ name: 'y', type: 'named' }),
          expect.objectContaining({ name: 'z', type: 'named' }),
        ])
      );
    });
  });
});