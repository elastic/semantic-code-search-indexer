import { LanguageConfiguration } from '../utils/parser';
import go from 'tree-sitter-go';

export const goConfig: LanguageConfiguration = {
  name: 'go',
  fileSuffixes: ['.go'],
  parser: go,
  queries: [
    '(import_declaration) @import',
    '(if_statement) @if',
    '(expression_statement) @expression',
    '(return_statement) @return',
    '(function_declaration) @function',
    '(type_declaration) @type',
    '(const_declaration) @const',
    '(var_declaration) @variable',
    '(method_declaration) @method',
    '(call_expression) @call',
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
      (type_declaration) @type
    ) @type_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (method_declaration) @method
    ) @method_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (var_declaration) @variable
    ) @variable_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (const_declaration) @const
    ) @const_with_doc
    `,
  ],
  importQueries: ['(import_spec path: (interpreted_string_literal) @import.path)'],
  symbolQueries: [
    '(function_declaration name: (identifier) @function.name)',
    '(method_declaration name: (field_identifier) @method.name)',
    '(type_spec name: (type_identifier) @type.name)',
    '(var_spec name: (identifier) @variable.name)',
    '(call_expression function: (identifier) @function.call)',
    '(call_expression function: (selector_expression field: (field_identifier)) @method.call)',
    '(composite_literal type: (type_identifier) @struct.instantiation)',
    '(short_var_declaration right: (expression_list (identifier)) @variable.usage)',
  ],
  exportQueries: [
    '(function_declaration name: (identifier) @export.name (#match? @export.name "^[A-Z]"))',
    '(type_spec name: (type_identifier) @export.name (#match? @export.name "^[A-Z]"))',
    '(const_spec name: (identifier) @export.name (#match? @export.name "^[A-Z]"))',
    '(var_spec name: (identifier) @export.name (#match? @export.name "^[A-Z]"))',
  ],
};
