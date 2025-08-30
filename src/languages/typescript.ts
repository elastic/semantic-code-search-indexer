// src/languages/typescript.ts
import ts from 'tree-sitter-typescript';
import { LanguageConfiguration } from '../utils/parser';

export const typescript: LanguageConfiguration = {
  name: 'typescript',
  fileSuffixes: ['.ts', '.tsx'],
  parser: ts.typescript,
  queries: [
    '(call_expression) @call',
    '(import_statement source: (string) @import.path)',
    '(comment) @comment',
    `
    (
      (comment)+ @doc
      .
      (function_declaration) @function
    ) @function_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (generator_function_declaration) @function
    ) @function_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (class_declaration) @class
    ) @class_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (method_definition) @method
    ) @method_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (lexical_declaration) @variable
    ) @variable_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (variable_declaration) @variable
    ) @variable_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (type_alias_declaration) @type
    ) @type_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (interface_declaration) @interface
    ) @interface_with_doc
    `,
  ],
  symbolQueries: [
    '(function_declaration name: (identifier) @function.name)',
    '(generator_function_declaration name: (identifier) @function.name)',
    '(class_declaration name: (type_identifier) @class.name)',
    '(method_definition name: (property_identifier) @method.name)',
    '(variable_declarator name: (identifier) @variable.name)',
    '(type_alias_declaration name: (type_identifier) @type.name)',
    '(interface_declaration name: (type_identifier) @interface.name)',
  ],
};