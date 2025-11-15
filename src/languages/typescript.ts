// src/languages/typescript.ts
import ts from 'tree-sitter-typescript';
import { LanguageConfiguration } from '../utils/parser';

export const typescript: LanguageConfiguration = {
  name: 'typescript',
  fileSuffixes: ['.ts', '.tsx'],
  parser: ts.typescript,
  queries: [
    '(import_statement) @import',
    '(lexical_declaration) @variable',
    '(class_declaration) @class',
    '(interface_declaration) @interface',
    '(export_statement) @export',
    '(comment) @comment',
    '(function_declaration) @function',
    '(type_alias_declaration) @type',
    '(call_expression) @call',
    '(_ (comment)+ @doc)',
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
  importQueries: [
    '(import_statement (import_clause (named_imports (import_specifier name: (identifier) @import.symbol))) source: (string) @import.path)',
    '(import_statement (import_clause (namespace_import (identifier) @import.symbol)) source: (string) @import.path)',
    '(import_statement (import_clause (identifier) @import.symbol) source: (string) @import.path)',
    '(import_statement source: (string) @import.path)',
    '(import_statement "type" (import_clause (named_imports (import_specifier name: (identifier) @import.symbol))) source: (string) @import.path)',
  ],
  symbolQueries: [
    '(function_declaration name: (identifier) @function.name)',
    '(generator_function_declaration name: (identifier) @function.name)',
    '(class_declaration name: (type_identifier) @class.name)',
    '(method_definition name: (property_identifier) @method.name)',
    '(variable_declarator name: (identifier) @variable.name)',
    '(type_alias_declaration name: (type_identifier) @type.name)',
    '(interface_declaration name: (type_identifier) @interface.name)',
    '(call_expression function: (identifier) @function.call)',
    '(new_expression constructor: (identifier) @class.instantiation)',
    '(variable_declarator value: (identifier) @variable.usage)',
  ],
  exportQueries: [
    '(export_statement (lexical_declaration (variable_declarator name: (identifier) @export.name)))',
    '(export_statement (function_declaration name: (identifier) @export.name))',
    '(export_statement (class_declaration name: (type_identifier) @export.name))',
    '(export_statement (interface_declaration name: (type_identifier) @export.name))',
    '(export_statement (type_alias_declaration name: (type_identifier) @export.name))',
    '(export_statement "default" @export.default)',
    '(export_statement (export_clause (export_specifier name: (identifier) @export.name)))',
    '(export_statement (export_clause (export_specifier name: (identifier) alias: (identifier) @export.name)))',
    '(export_statement "*" @export.namespace (string) @export.source)',
    '(export_statement (export_clause) (string) @export.source)',
  ],
};
