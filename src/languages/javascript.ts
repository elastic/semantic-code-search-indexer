// src/languages/javascript.ts
import js from 'tree-sitter-javascript';
import { LanguageConfiguration } from '../utils/parser';

export const javascript: LanguageConfiguration = {
  name: 'javascript',
  fileSuffixes: ['.js', '.jsx'],
  parser: js,
  queries: [
    '(import_statement) @import',
    '(lexical_declaration) @variable',
    '(if_statement) @if',
    '(expression_statement) @expression',
    '(return_statement) @return',
    '(method_definition) @method',
    '(class_declaration) @class',
    '(export_statement) @export',
    '(call_expression) @call',
    '(comment) @comment',
    '(function_declaration) @function',
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
  ],
  importQueries: [
    '(import_statement (import_clause (named_imports (import_specifier name: (identifier) @import.symbol))) source: (string) @import.path)',
    '(import_statement (import_clause (namespace_import (identifier) @import.symbol)) source: (string) @import.path)',
    '(import_statement (import_clause (identifier) @import.symbol) source: (string) @import.path)',
    '(import_statement source: (string) @import.path)',
  ],
  symbolQueries: [
    '(function_declaration name: (identifier) @function.name)',
    '(generator_function_declaration name: (identifier) @function.name)',
    '(class_declaration name: (identifier) @class.name)',
    '(method_definition name: (property_identifier) @method.name)',
    '(variable_declarator name: (identifier) @variable.name)',
  ],
  exportQueries: [
    '(export_statement (lexical_declaration (variable_declarator name: (identifier) @export.name)))',
    '(export_statement (function_declaration name: (identifier) @export.name))',
    '(export_statement (class_declaration name: (identifier) @export.name))',
    '(export_statement "default" @export.default)',
    '(export_statement (export_clause (export_specifier name: (identifier) @export.name)))',
    '(export_statement (export_clause (export_specifier name: (identifier) alias: (identifier) @export.name)))',
    '(export_statement "*" @export.namespace (string) @export.source)',
    '(export_statement (export_clause) (string) @export.source)',
  ],
};
