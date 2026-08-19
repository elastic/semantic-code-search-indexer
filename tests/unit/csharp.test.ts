import path from 'path';
import { describe, expect, it } from 'vitest';
import { LanguageParser } from '../../src/utils/parser';

describe('C# language configuration', () => {
  const filePath = path.resolve(__dirname, '../fixtures/csharp.cs');
  const result = new LanguageParser('csharp').parseFile(filePath, 'main', 'tests/fixtures/csharp.cs');

  it('creates structural and member chunks', () => {
    const kinds = result.chunks.map((chunk) => chunk.kind);

    expect(kinds).toEqual(
      expect.arrayContaining([
        'using_directive',
        'interface_declaration',
        'class_declaration',
        'field_declaration',
        'property_declaration',
        'constructor_declaration',
        'method_declaration',
        'record_declaration',
        'enum_declaration',
        'delegate_declaration',
      ])
    );
  });

  it('extracts imports, symbols, public exports, and C# container paths', () => {
    const systemImport = result.chunks.find((chunk) => chunk.content === 'using System.Collections.Generic;');
    expect(systemImport?.imports).toContainEqual({
      path: 'System.Collections.Generic',
      type: 'module',
      symbols: [],
    });

    const method = result.chunks.find(
      (chunk) => chunk.kind === 'method_declaration' && chunk.content.includes('layers.Add (layer)')
    );
    expect(method).toBeDefined();
    expect(method?.containerPath).toBe('LayerService');
    expect(method?.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'AddLayer', kind: 'method.name' }),
        expect.objectContaining({ name: 'Add', kind: 'method.call' }),
      ])
    );
    expect(method?.exports).toContainEqual({ name: 'AddLayer', type: 'named' });

    const record = result.chunks.find((chunk) => chunk.kind === 'record_declaration');
    expect(record?.symbols).toContainEqual(expect.objectContaining({ name: 'Layer', kind: 'record.name' }));
    expect(record?.exports).toContainEqual({ name: 'Layer', type: 'named' });
  });
});
