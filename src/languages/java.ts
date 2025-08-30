import { LanguageConfiguration } from '../utils/parser';
import java from 'tree-sitter-java';

export const javaConfig: LanguageConfiguration = {
  name: 'java',
  fileSuffixes: ['.java'],
  parser: java,
    queries: [
    '(method_invocation) @call',
    '(import_declaration) @import',
    '(line_comment) @comment',
    '(block_comment) @comment',
    `
    (
      (block_comment)+ @doc
      .
      (class_declaration) @class
    ) @class_with_doc
    `,
    `
    (
      (block_comment)+ @doc
      .
      (method_declaration) @method
    ) @method_with_doc
    `,
  ],
  symbolQueries: [
    '(class_declaration name: (identifier) @class.name)',
    '(method_declaration name: (identifier) @method.name)',
  ],
};
