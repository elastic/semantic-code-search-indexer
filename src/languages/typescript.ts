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
};