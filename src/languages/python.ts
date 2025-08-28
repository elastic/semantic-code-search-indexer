import { LanguageConfiguration } from '../utils/parser';
import python from 'tree-sitter-python';

export const pythonConfig: LanguageConfiguration = {
  name: 'python',
  fileSuffixes: ['.py'],
  parser: python,
  queries: [
    '(class_definition) @class',
    '(function_definition) @function',
    '(import_statement) @import',
    '(import_from_statement) @import',
  ],
  symbolQueries: [
    '(class_definition name: (identifier) @symbol)',
    '(function_definition name: (identifier) @symbol)',
  ],
};
