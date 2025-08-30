// src/languages/javascript.ts
import js from 'tree-sitter-javascript';
import { LanguageConfiguration } from '../utils/parser';

export const javascript: LanguageConfiguration = {
  name: 'javascript',
  fileSuffixes: ['.js', '.jsx'],
  parser: js,
  queries: [
    '(call_expression) @call',
    '(import_statement) @import',
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
  ],
  symbolQueries: [
    '(function_declaration name: (identifier) @function.name)',
    '(generator_function_declaration name: (identifier) @function.name)',
    '(class_declaration name: (identifier) @class.name)',
    '(method_definition name: (property_identifier) @method.name)',
    '(variable_declarator name: (identifier) @variable.name)',
  ],
};