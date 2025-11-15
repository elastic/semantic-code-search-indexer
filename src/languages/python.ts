import { LanguageConfiguration } from '../utils/parser';
import python from 'tree-sitter-python';

export const pythonConfig: LanguageConfiguration = {
  name: 'python',
  fileSuffixes: ['.py'],
  parser: python,
  queries: [
    '(import_statement) @import',
    '(import_from_statement) @import_from',
    '(if_statement) @if',
    '(expression_statement) @expression',
    '(return_statement) @return',
    '(function_definition) @function',
    '(class_definition) @class',
    '(call) @call',
    '(comment) @comment',
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
      (class_definition) @class
    ) @class_with_doc
    `,
    `
    (
      (comment)+ @doc
      .
      (expression_statement (assignment)) @variable
    ) @variable_with_doc
    `,
  ],
  importQueries: [
    '(import_statement name: (dotted_name) @import.path)',
    '(import_from_statement module_name: (dotted_name) @import.path (dotted_name (identifier) @import.symbol))',
    '(import_from_statement module_name: (dotted_name) @import.path (wildcard_import) @import.symbol)',
  ],
  symbolQueries: [
    '(class_definition name: (identifier) @class.name)',
    '(function_definition name: (identifier) @function.name)',
    '(expression_statement (assignment left: (identifier) @variable.name))',
    '(call function: (identifier) @function.call)',
    '(assignment right: (identifier) @variable.usage)',
  ],
  exportQueries: [
    '(module (function_definition name: (identifier) @export.name))',
    '(module (class_definition name: (identifier) @export.name))',
    '(module (expression_statement (assignment left: (identifier) @export.name (#match? @export.name "^[A-Z_][A-Z0-9_]*$"))))',
  ],
};
