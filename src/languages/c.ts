import c from 'tree-sitter-c';
import { LanguageConfiguration } from '../utils/parser';

/**
 * Configuration for c language parsing
 *
 * This configuration uses tree-sitter for parsing and extracting code structure.
 * For more information, see: https://tree-sitter.github.io/tree-sitter/
 */
export const cConfig: LanguageConfiguration = {
  name: 'c',
  fileSuffixes: ['.c', '.h'],
  parser: c,
  queries: [
    '(preproc_include) @import',
    '(declaration) @variable',
    '(struct_specifier) @struct',
    '(union_specifier) @union',
    '(enum_specifier) @enum',
    '(type_definition) @type',
    '(comment) @comment',
    '(function_definition) @function',
    '(call_expression) @call',
    '(return_statement) @return',
    '(if_statement) @if',
    '(expression_statement) @expression',
    '(_ (comment)+ @doc)',
    `
    (
      (comment)+ @doc
      .
      (function_definition) @function
    ) @function_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (struct_specifier) @struct
    ) @struct_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (union_specifier) @union
    ) @union_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (enum_specifier) @enum
    ) @enum_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (declaration) @variable
    ) @variable_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (type_definition) @type
    ) @type_with_doc
    `,
  ],
  importQueries: [
    '(preproc_include path: (system_lib_string) @import.path)',
    '(preproc_include path: (string_literal) @import.path)',
  ],
  symbolQueries: [
    '(function_definition declarator: (function_declarator declarator: (identifier) @function.name))',
    '(declaration declarator: (init_declarator declarator: (identifier) @variable.name))',
    '(declaration declarator: (identifier) @variable.name)',
    '(struct_specifier name: (type_identifier) @struct.name)',
    '(union_specifier name: (type_identifier) @union.name)',
    '(enum_specifier name: (type_identifier) @enum.name)',
    '(type_definition declarator: (type_identifier) @type.name)',
    '(call_expression function: (identifier) @function.call)',
    '(field_declaration declarator: (field_identifier) @field.name)',
    '(parameter_declaration declarator: (identifier) @parameter.name)',
    '(parameter_declaration declarator: (pointer_declarator declarator: (identifier) @parameter.name))',
  ],
  exportQueries: [
    // In C, header files (.h) typically contain declarations that are "exported"
    // Functions and variables declared in header files are considered public
    // We can identify functions/structs/etc that might be exported
    '(function_definition declarator: (function_declarator declarator: (identifier) @export.name))',
    '(struct_specifier name: (type_identifier) @export.name)',
    '(union_specifier name: (type_identifier) @export.name)',
    '(enum_specifier name: (type_identifier) @export.name)',
    '(type_definition declarator: (type_identifier) @export.name)',
  ],
};
