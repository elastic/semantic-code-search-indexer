import { LanguageConfiguration } from '../utils/parser';
import go from 'tree-sitter-go';

export const goConfig: LanguageConfiguration = {
  name: 'go',
  fileSuffixes: ['.go'],
  parser: go,
    queries: [
    '(call_expression) @call',
    '(import_declaration) @import',
    '(import_spec path: (interpreted_string_literal) @import.path)',
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
  ],
  symbolQueries: [
    '(function_declaration name: (identifier) @function.name)',
    '(method_declaration name: (field_identifier) @method.name)',
    '(type_spec name: (type_identifier) @type.name)',
  ],
};
