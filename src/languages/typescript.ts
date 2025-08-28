// src/languages/typescript.ts
import ts from 'tree-sitter-typescript';
import { LanguageConfiguration } from '../utils/parser';

export const typescript: LanguageConfiguration = {
  name: 'typescript',
  fileSuffixes: ['.ts', '.tsx'],
  parser: ts.typescript,
  queries: [
    '(call_expression) @call',
    '(import_statement) @import',
    '(comment) @comment',
    '(function_declaration) @function',
    '(generator_function_declaration) @function',
    '(class_declaration) @class',
    '(method_definition) @method',
    '(lexical_declaration) @variable',
    '(variable_declaration) @variable',
    '(type_alias_declaration) @type',
    '(interface_declaration) @interface',
  ],
  symbolQueries: [
    '(function_declaration name: (identifier) @symbol)',
    '(generator_function_declaration name: (identifier) @symbol)',
    '(class_declaration name: (type_identifier) @symbol)',
    '(method_definition name: (property_identifier) @symbol)',
    '(variable_declarator name: (identifier) @symbol)',
    '(type_alias_declaration name: (type_identifier) @symbol)',
    '(interface_declaration name: (type_identifier) @symbol)',
  ],
};