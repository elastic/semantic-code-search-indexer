// tests/parser.test.ts
import { LanguageParser } from '../src/utils/parser';
import { CodeChunk } from '../src/utils/elasticsearch';
import path from 'path';
import { indexingConfig } from '../src/config';
import fs from 'fs';

const MOCK_TIMESTAMP = '[TIMESTAMP]';

// Supported languages for testing
const TEST_LANGUAGES = [
  'typescript',
  'javascript',
  'markdown',
  'yaml',
  'java',
  'go',
  'python',
  'json',
  'gradle',
  'properties',
  'text',
  'handlebars',
  'c',
  'cpp',
].join(',');

describe('LanguageParser', () => {
  let parser: LanguageParser;

  beforeAll(() => {
    process.env.SEMANTIC_CODE_INDEXER_LANGUAGES = TEST_LANGUAGES;
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

  describe('Configurable Markdown Delimiter', () => {
    it('should parse Markdown with default paragraph delimiter', () => {
      const filePath = path.resolve(__dirname, 'fixtures/markdown.md');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/markdown.md');
      
      // Should create 4 chunks with paragraph-based splitting
      expect(result.chunks.length).toBe(4);
      expect(result.metrics.parserType).toBe('markdown');
    });

    it('should parse Markdown with section delimiter (---)', () => {
      const originalDelimiter = indexingConfig.markdownChunkDelimiter;
      indexingConfig.markdownChunkDelimiter = '\\n---\\n';
      
      try {
        const filePath = path.resolve(__dirname, 'fixtures/markdown_sections.md');
        const result = parser.parseFile(filePath, 'main', 'tests/fixtures/markdown_sections.md');
        
        // Should create 3 chunks (split by ---)
        expect(result.chunks.length).toBe(3);
        
        // First chunk should contain Section 1
        expect(result.chunks[0].content).toContain('Section 1');
        expect(result.chunks[0].content).toContain('first section');
        
        // Second chunk should contain Section 2
        expect(result.chunks[1].content).toContain('Section 2');
        expect(result.chunks[1].content).toContain('second section');
        
        // Third chunk should contain Section 3
        expect(result.chunks[2].content).toContain('Section 3');
        expect(result.chunks[2].content).toContain('final section');
        
        // Verify line numbers are calculated correctly
        expect(result.chunks[0].startLine).toBe(1);
        expect(result.chunks[1].startLine).toBeGreaterThan(result.chunks[0].endLine);
        expect(result.chunks[2].startLine).toBeGreaterThan(result.chunks[1].endLine);
      } finally {
        indexingConfig.markdownChunkDelimiter = originalDelimiter;
      }
    });

    it('should parse Markdown with custom delimiter (===)', () => {
      const originalDelimiter = indexingConfig.markdownChunkDelimiter;
      indexingConfig.markdownChunkDelimiter = '\\n===\\n';
      
      try {
        // Create temporary test file
        const testContent = `Part 1
Content here

===

Part 2
More content

===

Part 3
Final content`;
        
        const tempFile = path.join(__dirname, 'fixtures', 'temp_custom_delimiter.md');
        fs.writeFileSync(tempFile, testContent);
        
        const result = parser.parseFile(tempFile, 'main', 'temp_custom_delimiter.md');
        
        // Should create 3 chunks
        expect(result.chunks.length).toBe(3);
        expect(result.chunks[0].content).toContain('Part 1');
        expect(result.chunks[1].content).toContain('Part 2');
        expect(result.chunks[2].content).toContain('Part 3');
        
        // Clean up
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } finally {
        indexingConfig.markdownChunkDelimiter = originalDelimiter;
      }
    });

    it('should handle markdown with no delimiter matches', () => {
      const originalDelimiter = indexingConfig.markdownChunkDelimiter;
      indexingConfig.markdownChunkDelimiter = '\\n---\\n';
      
      try {
        // Use a file without --- delimiters
        const filePath = path.resolve(__dirname, 'fixtures/markdown.md');
        const result = parser.parseFile(filePath, 'main', 'tests/fixtures/markdown.md');
        
        // Should create 1 chunk (entire file)
        expect(result.chunks.length).toBe(1);
        expect(result.chunks[0].content).toContain('Markdown Fixture');
      } finally {
        indexingConfig.markdownChunkDelimiter = originalDelimiter;
      }
    });

    it('should filter empty chunks when using custom delimiter', () => {
      const originalDelimiter = indexingConfig.markdownChunkDelimiter;
      indexingConfig.markdownChunkDelimiter = '\\n---\\n';
      
      try {
        const testContent = `Content 1

---

---

Content 2`;
        
        const tempFile = path.join(__dirname, 'fixtures', 'temp_empty_chunks.md');
        fs.writeFileSync(tempFile, testContent);
        
        const result = parser.parseFile(tempFile, 'main', 'temp_empty_chunks.md');
        
        // Should only create 2 chunks (empty chunk between --- should be filtered)
        expect(result.chunks.length).toBe(2);
        expect(result.chunks[0].content).toContain('Content 1');
        expect(result.chunks[1].content).toContain('Content 2');
        
        // Clean up
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } finally {
        indexingConfig.markdownChunkDelimiter = originalDelimiter;
      }
    });
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

  it('should parse C fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/c.c');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/c.c');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should extract symbols from C fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/c.c');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/c.c');
    const allSymbols = result.chunks.flatMap(chunk => chunk.symbols);
    expect(allSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'add', kind: 'function.name' }),
        expect.objectContaining({ name: 'test_function', kind: 'function.name' }),
        expect.objectContaining({ name: 'main', kind: 'function.name' }),
        expect.objectContaining({ name: 'add', kind: 'function.call' }),
        expect.objectContaining({ name: 'printf', kind: 'function.call' }),
        expect.objectContaining({ name: 'Point', kind: 'struct.name' }),
        expect.objectContaining({ name: 'Data', kind: 'union.name' }),
        expect.objectContaining({ name: 'Color', kind: 'enum.name' }),
        expect.objectContaining({ name: 'Point_t', kind: 'type.name' }),
        expect.objectContaining({ name: 'global_var', kind: 'variable.name' }),
        expect.objectContaining({ name: 'point', kind: 'variable.name' }),
      ])
    );
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

  it('should parse C++ fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/cpp.cpp');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/cpp.cpp');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should extract symbols from C++ fixtures correctly', () => {
    const filePath = path.resolve(__dirname, 'fixtures/cpp.cpp');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/cpp.cpp');
    const allSymbols = result.chunks.flatMap(chunk => chunk.symbols);
    
    // Basic checks - verify key symbols are extracted
    expect(allSymbols).toEqual(
      expect.arrayContaining([
        // Classes and structs
        expect.objectContaining({ name: 'MyClass', kind: 'class.name' }),
        expect.objectContaining({ name: 'Point', kind: 'struct.name' }),
        
        // Namespace
        expect.objectContaining({ name: 'MyNamespace', kind: 'namespace.name' }),
        
        // Template method inside class
        expect.objectContaining({ name: 'templateMethod', kind: 'function.name' }),
      ])
    );
    
    // Verify we have a reasonable number of symbols
    expect(allSymbols.length).toBeGreaterThan(10);
  });

  it('should filter out chunks larger than maxChunkSizeBytes', () => {
    const filePath = path.resolve(__dirname, 'fixtures/large_file.json');
    const originalMaxChunkSizeBytes = indexingConfig.maxChunkSizeBytes;
    indexingConfig.maxChunkSizeBytes = 50;

    try {
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/large_file.json');
      // With the new line-based chunking approach, all chunks smaller than the limit should pass
      // The file has 5 lines. With 15-line default chunks, the entire file fits in one chunk
      // Since the entire file content is less than 50 bytes when chunked by lines, it should be filtered
      expect(result.chunks.length).toBe(0);
      expect(result.metrics.chunksSkipped).toBe(1);
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

  describe('Configurable Line-Based Chunking', () => {
    it('parses JSON with configurable chunk size', () => {
      const originalChunkLines = indexingConfig.defaultChunkLines;
      const originalOverlapLines = indexingConfig.chunkOverlapLines;
      
      indexingConfig.defaultChunkLines = 10;
      indexingConfig.chunkOverlapLines = 2;
      
      try {
        const filePath = path.resolve(__dirname, 'fixtures/json.json');
        const result = parser.parseFile(filePath, 'main', 'tests/fixtures/json.json');
        
        // json.json has 32 lines. With 10-line chunks and 2-line overlap (step=8):
        // Chunk 1: 1-10, Chunk 2: 9-18, Chunk 3: 17-26, Chunk 4: 25-32
        expect(result.chunks.length).toBeGreaterThan(1);
        
        // First chunk should be 10 lines
        expect(result.chunks[0].startLine).toBe(1);
        expect(result.chunks[0].endLine).toBe(10);
        
        // Second chunk should overlap by 2 lines (start at line 9)
        if (result.chunks.length > 1) {
          expect(result.chunks[1].startLine).toBe(9); // 10 - 2 + 1 = 9
        }
      } finally {
        indexingConfig.defaultChunkLines = originalChunkLines;
        indexingConfig.chunkOverlapLines = originalOverlapLines;
      }
    });

    it('parses YAML with configurable chunk size', () => {
      const originalChunkLines = indexingConfig.defaultChunkLines;
      const originalOverlapLines = indexingConfig.chunkOverlapLines;
      
      indexingConfig.defaultChunkLines = 5;
      indexingConfig.chunkOverlapLines = 1;
      
      try {
        const filePath = path.resolve(__dirname, 'fixtures/yaml.yml');
        const result = parser.parseFile(filePath, 'main', 'tests/fixtures/yaml.yml');
        
        // yaml.yml has 8 lines. With 5-line chunks and 1-line overlap (step=4):
        // Chunk 1: 1-5, Chunk 2: 5-8
        expect(result.chunks.length).toBe(2);
        
        expect(result.chunks[0].startLine).toBe(1);
        expect(result.chunks[0].endLine).toBe(5);
        
        expect(result.chunks[1].startLine).toBe(5); // 1 + 4 = 5
        expect(result.chunks[1].endLine).toBe(8);
        
        // Verify document separator is included naturally
        expect(result.chunks[0].content).toContain('---');
      } finally {
        indexingConfig.defaultChunkLines = originalChunkLines;
        indexingConfig.chunkOverlapLines = originalOverlapLines;
      }
    });

    it('skips oversized JSON chunks', () => {
      const originalMaxChunkSize = indexingConfig.maxChunkSizeBytes;
      const originalChunkLines = indexingConfig.defaultChunkLines;
      
      // Set very small chunk size to force skipping
      indexingConfig.maxChunkSizeBytes = 10;
      indexingConfig.defaultChunkLines = 15;
      
      try {
        const filePath = path.resolve(__dirname, 'fixtures/json.json');
        const result = parser.parseFile(filePath, 'main', 'tests/fixtures/json.json');
        
        // All chunks should be skipped due to size limit
        expect(result.chunks.length).toBe(0);
        expect(result.metrics.chunksSkipped).toBeGreaterThan(0);
      } finally {
        indexingConfig.maxChunkSizeBytes = originalMaxChunkSize;
        indexingConfig.defaultChunkLines = originalChunkLines;
      }
    });

    it('parses text files with paragraphs using paragraph strategy', () => {
      // Create a fixture with paragraphs
      const testContent = `First paragraph.
This is part of the first paragraph.

Second paragraph starts here.

Third paragraph.`;
      
      const tempFile = path.join(__dirname, 'fixtures', 'temp_paragraphs.txt');
      fs.writeFileSync(tempFile, testContent);
      
      try {
        const result = parser.parseFile(tempFile, 'main', 'temp_paragraphs.txt');
        
        // Should use paragraph-based chunking and create 3 chunks
        expect(result.chunks.length).toBe(3);
        expect(result.chunks[0].content).toContain('First paragraph');
        expect(result.chunks[1].content).toContain('Second paragraph');
        expect(result.chunks[2].content).toContain('Third paragraph');
      } finally {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    });

    it('falls back to line-based chunking for text without paragraphs', () => {
      // Create a fixture without paragraphs (no double newlines)
      const testContent = `Line 1
Line 2
Line 3
Line 4
Line 5
Line 6
Line 7
Line 8
Line 9
Line 10
Line 11
Line 12
Line 13
Line 14
Line 15
Line 16
Line 17
Line 18`;
      
      const tempFile = path.join(__dirname, 'fixtures', 'temp_no_paragraphs.txt');
      fs.writeFileSync(tempFile, testContent);
      
      try {
        const result = parser.parseFile(tempFile, 'main', 'temp_no_paragraphs.txt');
        
        // Should fall back to line-based chunking
        // With default 15 lines per chunk and 3-line overlap (step=12):
        // Chunk 1: 1-15, Chunk 2: 13-18
        expect(result.chunks.length).toBe(2);
        expect(result.chunks[0].startLine).toBe(1);
        expect(result.chunks[0].endLine).toBe(15);
        expect(result.chunks[1].startLine).toBe(13); // 1 + 12 = 13
      } finally {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
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
      
      // With line-based chunking, the entire YAML file (8 lines) fits in one chunk (default 15 lines)
      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].startLine).toBe(1);
      expect(result.chunks[0].endLine).toBe(8);
      // Verify it contains content from both documents
      expect(result.chunks[0].content).toContain('document: one');
      expect(result.chunks[0].content).toContain('document: two');
      expect(result.chunks[0].content).toContain('---'); // document separator
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
      
      // With line-based chunking (default 15 lines per chunk, 3 line overlap), json.json (32 lines) will be split into chunks
      // Chunk 1: lines 1-15, Chunk 2: lines 13-27, Chunk 3: lines 25-32 (or similar based on step size)
      expect(result.chunks.length).toBeGreaterThan(0);
      
      // First chunk should start at line 1
      expect(result.chunks[0].startLine).toBe(1);
      expect(result.chunks[0].endLine).toBeLessThanOrEqual(15);
      
      // Verify chunks contain actual JSON content
      expect(result.chunks[0].content).toContain('{');
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

    it('should respect Python __all__ when present', () => {
      const filePath = path.resolve(__dirname, 'fixtures/python_with_all.py');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python_with_all.py');
      
      const allExports = result.chunks.flatMap(chunk => chunk.exports || []);
      
      // Should only export items in __all__
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'public_function', type: 'named' }),
          expect.objectContaining({ name: 'PublicClass', type: 'named' }),
        ])
      );
      
      // Should NOT export items not in __all__
      expect(allExports).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: '_private_helper' }),
        ])
      );
      expect(allExports).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'SECRET_CONSTANT' }),
        ])
      );
      
      // Verify we have exactly 2 exports
      expect(allExports.length).toBe(2);
    });

    it('should handle Python __all__ with trailing commas and multiline', () => {
      const filePath = path.resolve(__dirname, 'fixtures/python_all_edge_cases.py');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python_all_edge_cases.py');
      
      const allExports = result.chunks.flatMap(chunk => chunk.exports || []);
      
      // Should handle trailing commas and multiline __all__
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'function_one', type: 'named' }),
          expect.objectContaining({ name: 'ClassTwo', type: 'named' }),
        ])
      );
      
      // Should not export items not in __all__
      expect(allExports).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'not_exported' }),
        ])
      );
      
      expect(allExports.length).toBe(2);
    });

    it('should handle Python empty __all__', () => {
      const filePath = path.resolve(__dirname, 'fixtures/python_empty_all.py');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python_empty_all.py');
      
      const allExports = result.chunks.flatMap(chunk => chunk.exports || []);
      
      // Empty __all__ should export nothing
      expect(allExports.length).toBe(0);
      
      // Verify functions and classes exist but are not exported
      expect(allExports).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'my_function' }),
        ])
      );
      expect(allExports).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'MyClass' }),
        ])
      );
      expect(allExports).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'MY_CONSTANT' }),
        ])
      );
    });

    it('should handle Python multiple __all__ assignments', () => {
      const filePath = path.resolve(__dirname, 'fixtures/python_multiple_all.py');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python_multiple_all.py');
      
      const allExports = result.chunks.flatMap(chunk => chunk.exports || []);
      
      // Should use the last __all__ assignment
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'bar', type: 'named' }),
        ])
      );
      
      // Should NOT export items from the first __all__
      expect(allExports).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'foo' }),
        ])
      );
      
      expect(allExports.length).toBe(1);
    });

    it('should handle Python __all__ with mixed valid and invalid items', () => {
      const filePath = path.resolve(__dirname, 'fixtures/python_all_mixed_valid.py');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python_all_mixed_valid.py');
      
      const allExports = result.chunks.flatMap(chunk => chunk.exports || []);
      
      // Should export the existing function that's in __all__
      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'existing_function', type: 'named' }),
        ])
      );
      
      // Should NOT export functions not in __all__
      expect(allExports).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'not_in_all' }),
        ])
      );
      
      // Note: nonexistent_function won't appear because there's no definition for it
      // The filtering logic only filters out items that have definitions but aren't in __all__
      // Items in __all__ that don't have definitions simply won't be found by the export queries
      expect(allExports.length).toBe(1);
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