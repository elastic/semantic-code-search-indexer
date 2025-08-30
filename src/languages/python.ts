import { LanguageConfiguration } from '../utils/parser';
import python from 'tree-sitter-python';

export const pythonConfig: LanguageConfiguration = {
  name: 'python',
  fileSuffixes: ['.py'],
  parser: python,
    queries: [
    '(call) @call',
    '(import_statement) @import',
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
  ],
  symbolQueries: [
    '(class_definition name: (identifier) @class.name)',
    '(function_definition name: (identifier) @function.name)',
  ],
};
