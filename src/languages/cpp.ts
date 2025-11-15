import cpp from 'tree-sitter-cpp';
import { LanguageConfiguration } from '../utils/parser';

/**
 * Configuration for C++ language parsing
 *
 * This configuration uses tree-sitter for parsing and extracting code structure.
 * For more information, see: https://tree-sitter.github.io/tree-sitter/
 */
export const cppConfig: LanguageConfiguration = {
  name: 'cpp',
  fileSuffixes: ['.cpp', '.hpp', '.cc', '.cxx', '.h'],
  parser: cpp,
  queries: [
    // Preprocessor directives
    '(preproc_include) @import',
    '(preproc_def) @define',

    // Declarations
    '(declaration) @variable',
    '(function_definition) @function',
    '(class_specifier) @class',
    '(struct_specifier) @struct',
    '(enum_specifier) @enum',
    '(union_specifier) @union',
    '(namespace_definition) @namespace',
    '(template_declaration) @template',
    '(type_definition) @type',

    // Statements
    '(comment) @comment',
    '(call_expression) @call',
    '(return_statement) @return',
    '(if_statement) @if',
    '(expression_statement) @expression',

    // Documentation patterns
    '(_ (comment)+ @doc)',

    // Function with documentation
    `
    (
      (comment)+ @doc
      .
      (function_definition) @function
    ) @function_with_doc
    `,

    // Class with documentation
    `
    (
      (comment)+ @doc
      .
      (class_specifier) @class
    ) @class_with_doc
    `,

    // Struct with documentation
    `
    (
      (comment)+ @doc
      .
      (struct_specifier) @struct
    ) @struct_with_doc
    `,

    // Namespace with documentation
    `
    (
      (comment)+ @doc
      .
      (namespace_definition) @namespace
    ) @namespace_with_doc
    `,

    // Template with documentation
    `
    (
      (comment)+ @doc
      .
      (template_declaration) @template
    ) @template_with_doc
    `,

    // Variable with documentation
    `
    (
      (comment)+ @doc
      .
      (declaration) @variable
    ) @variable_with_doc
    `,

    // Typedef with documentation
    `
    (
      (comment)+ @doc
      .
      (type_definition) @type
    ) @type_with_doc
    `,
  ],

  importQueries: [
    // System includes: #include <iostream>
    '(preproc_include path: (system_lib_string) @import.path)',
    // Local includes: #include "header.hpp"
    '(preproc_include path: (string_literal) @import.path)',
  ],

  symbolQueries: [
    // Function definitions
    '(function_definition declarator: (function_declarator declarator: (identifier) @function.name))',
    '(function_definition declarator: (function_declarator declarator: (qualified_identifier (identifier) @function.name)))',

    // Method definitions (within classes)
    '(function_definition declarator: (function_declarator declarator: (field_identifier) @method.name))',

    // Variable declarations
    '(declaration declarator: (init_declarator declarator: (identifier) @variable.name))',
    '(declaration declarator: (identifier) @variable.name)',

    // Class/struct/union names
    '(class_specifier name: (type_identifier) @class.name)',
    '(struct_specifier name: (type_identifier) @struct.name)',
    '(union_specifier name: (type_identifier) @union.name)',
    '(enum_specifier name: (type_identifier) @enum.name)',

    // Namespace names
    '(namespace_definition name: (namespace_identifier) @namespace.name)',

    // Template declarations
    '(template_declaration (function_definition declarator: (function_declarator declarator: (identifier) @function.name)))',
    '(template_declaration (class_specifier name: (type_identifier) @class.name))',

    // Type definitions (typedef, using)
    '(type_definition declarator: (type_identifier) @type.name)',
    '(alias_declaration name: (type_identifier) @type.name)',

    // Function calls
    '(call_expression function: (identifier) @function.call)',
    '(call_expression function: (qualified_identifier (identifier) @function.call))',
    '(call_expression function: (field_expression field: (field_identifier) @method.call))',

    // Field declarations
    '(field_declaration declarator: (field_identifier) @field.name)',

    // Parameter declarations
    '(parameter_declaration declarator: (identifier) @parameter.name)',
    '(parameter_declaration declarator: (pointer_declarator declarator: (identifier) @parameter.name))',
    '(parameter_declaration declarator: (reference_declarator (identifier) @parameter.name))',
  ],

  exportQueries: [
    // In C++, public members and functions in header files are typically "exported"
    // Functions and classes declared in header files
    '(function_definition declarator: (function_declarator declarator: (identifier) @export.name))',
    '(class_specifier name: (type_identifier) @export.name)',
    '(struct_specifier name: (type_identifier) @export.name)',
    '(enum_specifier name: (type_identifier) @export.name)',
    '(namespace_definition name: (namespace_identifier) @export.name)',
    '(type_definition declarator: (type_identifier) @export.name)',
    '(alias_declaration name: (type_identifier) @export.name)',

    // Template declarations
    '(template_declaration (function_definition declarator: (function_declarator declarator: (identifier) @export.name)))',
    '(template_declaration (class_specifier name: (type_identifier) @export.name))',
  ],
};
