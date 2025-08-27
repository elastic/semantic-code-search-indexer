import { LanguageConfiguration } from '../utils/parser';
import go from 'tree-sitter-go';

export const goConfig: LanguageConfiguration = {
  name: 'go',
  fileSuffixes: ['.go'],
  parser: go,
  queries: [
    '(function_declaration) @function',
    '(method_declaration) @method',
    '(type_declaration) @type',
    '(import_spec) @import',
  ],
};
