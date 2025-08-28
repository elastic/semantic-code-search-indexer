import { LanguageConfiguration } from '../utils/parser';
import java from 'tree-sitter-java';

export const javaConfig: LanguageConfiguration = {
  name: 'java',
  fileSuffixes: ['.java'],
  parser: java,
  queries: [
    '(class_declaration) @class',
    '(method_declaration) @method',
    '(import_declaration) @import',
  ],
  symbolQueries: [
    '(class_declaration name: (identifier) @symbol)',
    '(method_declaration name: (identifier) @symbol)',
  ],
};
