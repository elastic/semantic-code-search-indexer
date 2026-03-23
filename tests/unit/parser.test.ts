import { LanguageParser } from '../../src/utils/parser';
import { CodeChunk } from '../../src/utils/elasticsearch';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { describe, it, expect, beforeAll } from 'vitest';
import { withTestEnv } from './utils/test_env';

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
  'bash',
  'scala',
  'hcl',
  'plpgsql',
].join(',');

describe('LanguageParser', () => {
  let parser: LanguageParser;

  beforeAll(() => {
    parser = new LanguageParser(TEST_LANGUAGES);
  });

  const cleanTimestamps = (chunks: CodeChunk[]) => {
    return chunks.map((chunk) => ({
      ...chunk,
      created_at: MOCK_TIMESTAMP,
      updated_at: MOCK_TIMESTAMP,
    }));
  };

  it('should parse TypeScript usage fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/usage.ts');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/usage.ts');
    const allSymbols = result.chunks.flatMap((chunk) => chunk.symbols);
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
    const filePath = path.resolve(__dirname, '../fixtures/javascript.js');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/javascript.js');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Markdown fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/markdown.md');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/markdown.md');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  describe('Configurable Markdown Delimiter', () => {
    it('should parse Markdown with default paragraph delimiter', () => {
      const filePath = path.resolve(__dirname, '../fixtures/markdown.md');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/markdown.md');

      // Should create 4 chunks with paragraph-based splitting
      expect(result.chunks.length).toBe(4);
      expect(result.metrics.parserType).toBe('markdown');
    });

    it('should parse Markdown with section delimiter (---)', () =>
      withTestEnv({ SCS_IDXR_MARKDOWN_CHUNK_DELIMITER: '\n---\n' }, () => {
        const filePath = path.resolve(__dirname, '../fixtures/markdown_sections.md');
        const result = parser.parseFile(filePath, 'main', 'tests/fixtures/markdown_sections.md');

        expect(result.chunks.length).toBe(3);

        expect(result.chunks[0].content).toContain('Section 1');
        expect(result.chunks[0].content).toContain('first section');

        expect(result.chunks[1].content).toContain('Section 2');
        expect(result.chunks[1].content).toContain('second section');

        expect(result.chunks[2].content).toContain('Section 3');
        expect(result.chunks[2].content).toContain('final section');

        expect(result.chunks[0].startLine).toBe(1);
        expect(result.chunks[0].endLine).toBeDefined();
        expect(result.chunks[1].endLine).toBeDefined();
        expect(result.chunks[1].startLine).toBeGreaterThan(result.chunks[0].endLine!);
        expect(result.chunks[2].startLine).toBeGreaterThan(result.chunks[1].endLine!);
      }));

    it('should parse Markdown with custom delimiter (===)', () =>
      withTestEnv({ SCS_IDXR_MARKDOWN_CHUNK_DELIMITER: '\n===\n' }, () => {
        const testContent = `Part 1
Content here

===

Part 2
More content

===

Part 3
Final content`;

        const tempFile = path.join(__dirname, '../fixtures', 'temp_custom_delimiter.md');
        fs.writeFileSync(tempFile, testContent);

        try {
          const result = parser.parseFile(tempFile, 'main', 'temp_custom_delimiter.md');

          expect(result.chunks.length).toBe(3);
          expect(result.chunks[0].content).toContain('Part 1');
          expect(result.chunks[1].content).toContain('Part 2');
          expect(result.chunks[2].content).toContain('Part 3');
        } finally {
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        }
      }));

    it('should handle markdown with no delimiter matches', () =>
      withTestEnv({ SCS_IDXR_MARKDOWN_CHUNK_DELIMITER: '\n---\n' }, () => {
        const filePath = path.resolve(__dirname, '../fixtures/markdown.md');
        const result = parser.parseFile(filePath, 'main', 'tests/fixtures/markdown.md');

        expect(result.chunks.length).toBe(1);
        expect(result.chunks[0].content).toContain('Markdown Fixture');
      }));

    it('should filter empty chunks when using custom delimiter', () =>
      withTestEnv({ SCS_IDXR_MARKDOWN_CHUNK_DELIMITER: '\n---\n' }, () => {
        const testContent = `Content 1

---

---

Content 2`;

        const tempFile = path.join(__dirname, '../fixtures', 'temp_empty_chunks.md');
        fs.writeFileSync(tempFile, testContent);

        try {
          const result = parser.parseFile(tempFile, 'main', 'temp_empty_chunks.md');

          expect(result.chunks.length).toBe(2);
          expect(result.chunks[0].content).toContain('Content 1');
          expect(result.chunks[1].content).toContain('Content 2');
        } finally {
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        }
      }));
  });

  it('should parse YAML fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/yaml.yml');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/yaml.yml');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Java fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/java.java');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/java.java');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Go fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/go.go');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/go.go');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Python fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/python.py');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python.py');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse JSON fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/json.json');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/json.json');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Gradle fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/gradle.gradle');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/gradle.gradle');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Properties fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/properties.properties');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/properties.properties');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should extract symbols from Properties fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/properties.properties');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/properties.properties');
    const allSymbols = result.chunks.flatMap((chunk) => chunk.symbols);
    expect(allSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'key', kind: 'property.key' }),
        expect.objectContaining({ name: 'value', kind: 'property.value' }),
      ])
    );
  });

  it('should parse Text fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/text.txt');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/text.txt');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse Handlebars fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/handlebars.hbs');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/handlebars.hbs');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should parse C fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/c.c');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/c.c');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should extract symbols from C fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/c.c');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/c.c');
    const allSymbols = result.chunks.flatMap((chunk) => chunk.symbols);
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
    const filePath = path.resolve(__dirname, '../fixtures/handlebars.hbs');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/handlebars.hbs');

    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].language).toBe('handlebars');
    expect(result.metrics.parserType).toBe('handlebars');

    const content = result.chunks[0].content;
    expect(content).toContain('metricsets');
    expect(content).toContain('{{');
    expect(content).toContain('{{#each hosts}}');
    expect(content).toContain('{{path}}');

    expect(result.chunks[0].startLine).toBe(1);
    expect(result.chunks[0].endLine).toBeGreaterThan(1);
  });

  it('should recognize .hbs file extension', () => {
    const hbsFile = path.resolve(__dirname, '../fixtures/handlebars.hbs');
    const result = parser.parseFile(hbsFile, 'main', 'tests/fixtures/handlebars.hbs');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0].language).toBe('handlebars');
  });

  const assertExtensionRecognized = (source: string, ext: string, expectedLanguage: string) => {
    const prefix = `temp_${expectedLanguage}_${process.pid}_${Date.now()}`;
    const tmpFile = path.join(os.tmpdir(), `${prefix}${ext}`);
    fs.writeFileSync(tmpFile, source);
    try {
      const result = parser.parseFile(tmpFile, 'main', `${prefix}${ext}`);
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.chunks[0].language).toBe(expectedLanguage);
      expect(result.metrics.parserType).toBe('tree-sitter');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  };

  it('should recognize .scala file extension', () => {
    assertExtensionRecognized(
      `import scala.collection.mutable.ListBuffer\nobject Main { def hello(name: String): String = s"Hello, $name" }`,
      '.scala',
      'scala'
    );
  });

  it('should recognize .tf file extension', () => {
    assertExtensionRecognized(
      `resource "aws_s3_bucket" "logs" {\n  bucket = "my-logs-bucket"\n  acl    = "private"\n}`,
      '.tf',
      'hcl'
    );
  });

  it('should recognize .hcl file extension', () => {
    assertExtensionRecognized(`locals {\n  environment = "dev"\n}`, '.hcl', 'hcl');
  });

  it('should recognize .sql file extension as plpgsql', () => {
    const sqlFile = path.resolve(__dirname, '../fixtures/plpgsql.sql');
    const result = parser.parseFile(sqlFile, 'main', 'tests/fixtures/plpgsql.sql');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0].language).toBe('plpgsql');
    expect(result.metrics.parserType).toBe('tree-sitter');
  });

  it('should parse Scala fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/scala.scala');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/scala.scala');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0].language).toBe('scala');
    expect(result.metrics.parserType).toBe('tree-sitter');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should extract symbols from Scala fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/scala.scala');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/scala.scala');
    const allSymbols = result.chunks.flatMap((chunk) => chunk.symbols);
    expect(allSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Greeter', kind: 'trait.name' }),
        expect.objectContaining({ name: 'Person', kind: 'class.name' }),
        expect.objectContaining({ name: 'HelloWorld', kind: 'object.name' }),
        expect.objectContaining({ name: 'greet', kind: 'function.name' }),
        expect.objectContaining({ name: 'main', kind: 'function.name' }),
        expect.objectContaining({ name: 'greeting', kind: 'variable.name' }),
        expect.objectContaining({ name: 'counter', kind: 'variable.name' }),
      ])
    );
  });

  it('should extract imports from Scala fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/scala.scala');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/scala.scala');
    const allImports = result.chunks.flatMap((chunk) => chunk.imports || []);
    expect(allImports).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'scala.collection.mutable.ListBuffer' })])
    );
  });

  it('should extract exports from Scala fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/scala.scala');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/scala.scala');
    const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);
    expect(allExports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'HelloWorld' }),
        expect.objectContaining({ name: 'Greeter' }),
        expect.objectContaining({ name: 'Person' }),
      ])
    );
  });

  it('should parse HCL fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/hcl.tf');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/hcl.tf');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0].language).toBe('hcl');
    expect(result.metrics.parserType).toBe('tree-sitter');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should extract symbols from HCL fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/hcl.tf');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/hcl.tf');
    const allSymbols = result.chunks.flatMap((chunk) => chunk.symbols);
    expect(allSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'resource', kind: 'block.type' }),
        expect.objectContaining({ name: 'variable', kind: 'block.type' }),
        expect.objectContaining({ name: 'output', kind: 'block.type' }),
        expect.objectContaining({ name: 'locals', kind: 'block.type' }),
        expect.objectContaining({ name: 'aws_s3_bucket', kind: 'block.label' }),
        expect.objectContaining({ name: 'logs', kind: 'block.label' }),
        expect.objectContaining({ name: 'bucket', kind: 'attribute.name' }),
        expect.objectContaining({ name: 'description', kind: 'attribute.name' }),
      ])
    );
  });

  it('should extract symbols from PLpgSQL fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/plpgsql.sql');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/plpgsql.sql');
    const allSymbols = result.chunks.flatMap((chunk) => chunk.symbols);

    expect(allSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'status_enum', kind: 'type.name' }),
        expect.objectContaining({ name: 'accounts', kind: 'table.name' }),
        expect.objectContaining({ name: 'active_accounts', kind: 'view.name' }),
        expect.objectContaining({ name: 'calculate_bonus', kind: 'function.name' }),
        expect.objectContaining({ name: 'calculate_bonus', kind: 'function.call' }),
      ])
    );
  });

  it('should extract exports from PLpgSQL fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/plpgsql.sql');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/plpgsql.sql');
    const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);

    expect(allExports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'status_enum', type: 'named' }),
        expect.objectContaining({ name: 'accounts', type: 'named' }),
        expect.objectContaining({ name: 'active_accounts', type: 'named' }),
        expect.objectContaining({ name: 'calculate_bonus', type: 'named' }),
      ])
    );
  });

  it('should parse PLpgSQL fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/plpgsql.sql');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/plpgsql.sql');

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks.every((chunk) => chunk.language === 'plpgsql')).toBe(true);
    expect(result.chunks.some((chunk) => chunk.kind === 'create_function')).toBe(true);
    expect(result.chunks.some((chunk) => chunk.kind === 'create_table')).toBe(true);
    expect(result.chunks.some((chunk) => chunk.kind === 'create_type')).toBe(true);
    expect(result.chunks.some((chunk) => chunk.kind === 'create_view')).toBe(true);
    expect(result.chunks.some((chunk) => chunk.content.includes('calculate_bonus(100, 1.25)'))).toBe(true);
    expect(result.metrics.parserType).toBe('tree-sitter');
  });

  it('should parse C++ fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/cpp.cpp');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/cpp.cpp');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should extract symbols from C++ fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/cpp.cpp');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/cpp.cpp');
    const allSymbols = result.chunks.flatMap((chunk) => chunk.symbols);

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

  it('should parse Bash fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/bash.sh');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/bash.sh');
    expect(cleanTimestamps(result.chunks)).toMatchSnapshot();
  });

  it('should extract symbols from Bash fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/bash.sh');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/bash.sh');
    const allSymbols = result.chunks.flatMap((chunk) => chunk.symbols);
    expect(allSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'greet', kind: 'function.name' }),
        expect.objectContaining({ name: 'process_files', kind: 'function.name' }),
        expect.objectContaining({ name: 'calculate', kind: 'function.name' }),
        expect.objectContaining({ name: 'filter_logs', kind: 'function.name' }),
        expect.objectContaining({ name: 'get_timestamp', kind: 'function.name' }),
        expect.objectContaining({ name: 'parse_args', kind: 'function.name' }),
        expect.objectContaining({ name: 'show_help', kind: 'function.name' }),
        expect.objectContaining({ name: 'main', kind: 'function.name' }),
        expect.objectContaining({ name: 'SCRIPT_DIR', kind: 'variable.name' }),
        expect.objectContaining({ name: 'VERSION', kind: 'variable.name' }),
        expect.objectContaining({ name: 'VERBOSE', kind: 'variable.name' }),
        expect.objectContaining({ name: 'DEBUG_MODE', kind: 'variable.name' }),
        expect.objectContaining({ name: 'PATH', kind: 'variable.name' }),
        expect.objectContaining({ name: 'LOG_LEVEL', kind: 'variable.name' }),
      ])
    );
  });

  it('should extract imports from Bash fixtures correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/bash.sh');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/bash.sh');
    const allImports = result.chunks.flatMap((chunk) => chunk.imports);
    expect(allImports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining('utils.sh') }),
        expect.objectContaining({ path: expect.stringContaining('helpers.sh') }),
      ])
    );
  });

  it('should filter Bash exports correctly (export vs readonly/local)', () => {
    const testScript = `export EXPORTED_VAR="exported"
readonly READONLY_VAR="readonly"
local LOCAL_VAR="local"`;
    const tempFile = path.join(os.tmpdir(), `temp_bash_export_test_${process.pid}_${Date.now()}.sh`);
    fs.writeFileSync(tempFile, testScript);

    try {
      const result = parser.parseFile(tempFile, 'main', 'temp_bash_export_test.sh');
      const allExports = result.chunks.flatMap((chunk) => chunk.exports);
      const uniqueExports = Array.from(new Set(allExports.map((e) => e?.name)));

      expect(uniqueExports).toHaveLength(1);
      expect(uniqueExports[0]).toBe('EXPORTED_VAR');
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should capture array subscript variables in Bash', () => {
    const testScript = `arr=(one two three)
echo \${arr[@]}
echo \${arr[0]}`;
    const tempFile = path.join(os.tmpdir(), `temp_bash_array_test_${process.pid}_${Date.now()}.sh`);
    fs.writeFileSync(tempFile, testScript);

    try {
      const result = parser.parseFile(tempFile, 'main', 'temp_bash_array_test.sh');
      const allSymbols = result.chunks.flatMap((chunk) => chunk.symbols);
      const arrUsages = allSymbols.filter((s) => s?.name === 'arr' && s?.kind === 'variable.usage');

      expect(arrUsages.length).toBeGreaterThanOrEqual(2);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should handle export -f for Bash functions', () => {
    const testScript = `function my_func() {
    echo "test"
}
export -f my_func`;
    const tempFile = path.join(os.tmpdir(), `temp_bash_export_f_test_${process.pid}_${Date.now()}.sh`);
    fs.writeFileSync(tempFile, testScript);

    try {
      const result = parser.parseFile(tempFile, 'main', 'temp_bash_export_f_test.sh');
      const allExports = result.chunks.flatMap((chunk) => chunk.exports);

      expect(allExports.some((e) => e?.name === 'my_func')).toBe(true);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should filter out chunks larger than maxChunkSizeBytes', () =>
    withTestEnv({ SCS_IDXR_MAX_CHUNK_SIZE_BYTES: '50' }, () => {
      const filePath = path.resolve(__dirname, '../fixtures/large_file.json');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/large_file.json');

      expect(result.chunks.length).toBe(0);
      expect(result.metrics.chunksSkipped).toBe(1);
    }));

  it('should extract directory information correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/typescript.ts');
    const result = parser.parseFile(filePath, 'main', 'tests/fixtures/typescript.ts');

    expect(result.chunks.length).toBeGreaterThan(0);

    result.chunks.forEach((chunk) => {
      expect(chunk.directoryPath).toBe('tests/fixtures');
      expect(chunk.directoryName).toBe('fixtures');
      expect(chunk.directoryDepth).toBe(2);
    });
  });

  it('should handle root-level files correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/typescript.ts');
    const result = parser.parseFile(filePath, 'main', 'typescript.ts');

    expect(result.chunks.length).toBeGreaterThan(0);

    result.chunks.forEach((chunk) => {
      expect(chunk.directoryPath).toBe('');
      expect(chunk.directoryName).toBe('');
      expect(chunk.directoryDepth).toBe(0);
    });
  });

  it('should handle nested directory paths correctly', () => {
    const filePath = path.resolve(__dirname, '../fixtures/typescript.ts');
    const result = parser.parseFile(filePath, 'main', 'src/utils/helpers/typescript.ts');

    expect(result.chunks.length).toBeGreaterThan(0);

    result.chunks.forEach((chunk) => {
      expect(chunk.directoryPath).toBe('src/utils/helpers');
      expect(chunk.directoryName).toBe('helpers');
      expect(chunk.directoryDepth).toBe(3);
    });
  });

  describe('Configurable Line-Based Chunking', () => {
    it('parses JSON with configurable chunk size', () =>
      withTestEnv({ SCS_IDXR_DEFAULT_CHUNK_LINES: '10', SCS_IDXR_CHUNK_OVERLAP_LINES: '2' }, () => {
        const filePath = path.resolve(__dirname, '../fixtures/json.json');
        const result = parser.parseFile(filePath, 'main', 'tests/fixtures/json.json');

        expect(result.chunks.length).toBeGreaterThan(1);
        expect(result.chunks[0].startLine).toBe(1);
        expect(result.chunks[0].endLine).toBe(10);

        if (result.chunks.length > 1) {
          expect(result.chunks[1].startLine).toBe(9);
        }
      }));

    it('parses YAML with configurable chunk size', () =>
      withTestEnv({ SCS_IDXR_DEFAULT_CHUNK_LINES: '5', SCS_IDXR_CHUNK_OVERLAP_LINES: '1' }, () => {
        const filePath = path.resolve(__dirname, '../fixtures/yaml.yml');
        const result = parser.parseFile(filePath, 'main', 'tests/fixtures/yaml.yml');

        expect(result.chunks.length).toBe(2);
        expect(result.chunks[0].startLine).toBe(1);
        expect(result.chunks[0].endLine).toBe(5);
        expect(result.chunks[1].startLine).toBe(5);
        expect(result.chunks[1].endLine).toBe(8);
        expect(result.chunks[0].content).toContain('---');
      }));

    it('skips oversized JSON chunks', () =>
      withTestEnv({ SCS_IDXR_MAX_CHUNK_SIZE_BYTES: '10', SCS_IDXR_DEFAULT_CHUNK_LINES: '15' }, () => {
        const filePath = path.resolve(__dirname, '../fixtures/json.json');
        const result = parser.parseFile(filePath, 'main', 'tests/fixtures/json.json');

        expect(result.chunks.length).toBe(0);
        expect(result.metrics.chunksSkipped).toBeGreaterThan(0);
      }));

    it('parses text files with paragraphs using paragraph strategy', () => {
      const testContent = `First paragraph.
This is part of the first paragraph.

Second paragraph starts here.

Third paragraph.`;

      const tempFile = path.join(__dirname, '../fixtures', 'temp_paragraphs.txt');
      fs.writeFileSync(tempFile, testContent);

      try {
        const result = parser.parseFile(tempFile, 'main', 'temp_paragraphs.txt');

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

      const tempFile = path.join(__dirname, '../fixtures', 'temp_no_paragraphs.txt');
      fs.writeFileSync(tempFile, testContent);

      try {
        const result = parser.parseFile(tempFile, 'main', 'temp_no_paragraphs.txt');

        expect(result.chunks.length).toBe(2);
        expect(result.chunks[0].startLine).toBe(1);
        expect(result.chunks[0].endLine).toBe(15);
        expect(result.chunks[1].startLine).toBe(13);
      } finally {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    });
  });

  describe('Line Number Calculation', () => {
    it('should calculate correct line numbers for Markdown files', () => {
      const filePath = path.resolve(__dirname, '../fixtures/markdown.md');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/markdown.md');

      expect(result.chunks[0].startLine).toBe(1);
      expect(result.chunks[0].endLine).toBe(1);
      expect(result.chunks[1].startLine).toBe(3);
      expect(result.chunks[1].endLine).toBe(3);
      expect(result.chunks[2].startLine).toBe(5);
      expect(result.chunks[2].endLine).toBe(5);
      expect(result.chunks[3].startLine).toBe(7);
      expect(result.chunks[3].endLine).toBe(8);
    });

    it('should calculate correct line numbers for YAML multi-document files', () => {
      const filePath = path.resolve(__dirname, '../fixtures/yaml.yml');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/yaml.yml');

      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].startLine).toBe(1);
      expect(result.chunks[0].endLine).toBe(8);
      expect(result.chunks[0].content).toContain('document: one');
      expect(result.chunks[0].content).toContain('document: two');
      expect(result.chunks[0].content).toContain('---');
    });

    it('should handle duplicate content correctly in line number calculation', () => {
      const testContent = `First paragraph

Second paragraph

First paragraph

Third paragraph`;

      const testFilePath = path.resolve(__dirname, '../fixtures/duplicate_test.txt');
      fs.writeFileSync(testFilePath, testContent);

      try {
        const result = parser.parseFile(testFilePath, 'main', 'tests/fixtures/duplicate_test.txt');

        expect(result.chunks.length).toBe(4);
        expect(result.chunks[0].startLine).toBe(1);
        expect(result.chunks[0].content).toBe('First paragraph');
        expect(result.chunks[1].startLine).toBe(3);
        expect(result.chunks[1].content).toBe('Second paragraph');
        expect(result.chunks[2].startLine).toBe(5);
        expect(result.chunks[2].content).toBe('First paragraph');
        expect(result.chunks[3].startLine).toBe(7);
        expect(result.chunks[3].content).toBe('Third paragraph');
      } finally {
        if (fs.existsSync(testFilePath)) {
          fs.unlinkSync(testFilePath);
        }
      }
    });

    it('should calculate correct line numbers for JSON files', () => {
      const filePath = path.resolve(__dirname, '../fixtures/json.json');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/json.json');

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.chunks[0].startLine).toBe(1);
      expect(result.chunks[0].endLine).toBeLessThanOrEqual(15);
      expect(result.chunks[0].content).toContain('{');
    });

    it('should calculate correct line numbers for text files', () => {
      const filePath = path.resolve(__dirname, '../fixtures/text.txt');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/text.txt');

      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].startLine).toBe(1);
      expect(result.chunks[0].endLine).toBe(1);
    });

    it('should calculate correct line numbers for repeated paragraphs', () => {
      const filePath = path.resolve(__dirname, '../fixtures/repeated_paragraphs.txt');
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
      const filePath = path.resolve(__dirname, '../fixtures/typescript.ts');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/typescript.ts');

      const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);

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
      const filePath = path.resolve(__dirname, '../fixtures/javascript.js');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/javascript.js');

      const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);

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
      const filePath = path.resolve(__dirname, '../fixtures/python.py');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python.py');

      const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);

      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'MyClass', type: 'named' }),
          expect.objectContaining({ name: 'my_function', type: 'named' }),
          expect.objectContaining({ name: 'MY_CONSTANT', type: 'named' }),
        ])
      );
    });

    it('should respect Python __all__ when present', () => {
      const filePath = path.resolve(__dirname, '../fixtures/python_with_all.py');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python_with_all.py');

      const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);

      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'public_function', type: 'named' }),
          expect.objectContaining({ name: 'PublicClass', type: 'named' }),
        ])
      );

      expect(allExports).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: '_private_helper' })]));
      expect(allExports).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'SECRET_CONSTANT' })]));
      expect(allExports.length).toBe(2);
    });

    it('should handle Python __all__ with trailing commas and multiline', () => {
      const filePath = path.resolve(__dirname, '../fixtures/python_all_edge_cases.py');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python_all_edge_cases.py');

      const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);

      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'function_one', type: 'named' }),
          expect.objectContaining({ name: 'ClassTwo', type: 'named' }),
        ])
      );

      expect(allExports).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'not_exported' })]));
      expect(allExports.length).toBe(2);
    });

    it('should handle Python empty __all__', () => {
      const filePath = path.resolve(__dirname, '../fixtures/python_empty_all.py');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python_empty_all.py');

      const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);

      expect(allExports.length).toBe(0);
      expect(allExports).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'my_function' })]));
      expect(allExports).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'MyClass' })]));
      expect(allExports).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'MY_CONSTANT' })]));
    });

    it('should handle Python multiple __all__ assignments', () => {
      const filePath = path.resolve(__dirname, '../fixtures/python_multiple_all.py');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python_multiple_all.py');

      const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);

      expect(allExports).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'bar', type: 'named' })]));
      expect(allExports).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'foo' })]));
      expect(allExports.length).toBe(1);
    });

    it('should handle Python __all__ with mixed valid and invalid items', () => {
      const filePath = path.resolve(__dirname, '../fixtures/python_all_mixed_valid.py');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/python_all_mixed_valid.py');

      const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);

      expect(allExports).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'existing_function', type: 'named' })])
      );

      expect(allExports).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'not_in_all' })]));
      expect(allExports.length).toBe(1);
    });

    it('should extract Java public exports correctly', () => {
      const filePath = path.resolve(__dirname, '../fixtures/java.java');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/java.java');

      const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);

      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'MyClass', type: 'named' }),
          expect.objectContaining({ name: 'myMethod', type: 'named' }),
        ])
      );

      expect(allExports).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'privateMethod' })]));
    });

    it('should extract Go capitalized exports correctly', () => {
      const filePath = path.resolve(__dirname, '../fixtures/go.go');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/go.go');

      const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);

      expect(allExports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Hello', type: 'named' }),
          expect.objectContaining({ name: 'MyType', type: 'named' }),
          expect.objectContaining({ name: 'MyConst', type: 'named' }),
        ])
      );

      expect(allExports).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'privateFunc' })]));
    });

    it('should handle re-exports and mixed export styles', () => {
      const filePath = path.resolve(__dirname, '../fixtures/exports_edge_cases.ts');
      const result = parser.parseFile(filePath, 'main', 'tests/fixtures/exports_edge_cases.ts');

      const allExports = result.chunks.flatMap((chunk) => chunk.exports || []);

      expect(allExports).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'bar', type: 'named' })]));
      expect(allExports).toEqual(expect.arrayContaining([expect.objectContaining({ name: '*', type: 'namespace' })]));
      expect(allExports).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'a', type: 'named' })]));
      expect(allExports).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'B', type: 'default' })]));
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
