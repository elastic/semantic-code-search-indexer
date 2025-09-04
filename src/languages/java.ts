import { LanguageConfiguration } from '../utils/parser';
import java from 'tree-sitter-java';

export const javaConfig: LanguageConfiguration = {
  name: 'java',
  fileSuffixes: ['.java'],
  parser: java,
    queries: [
    '(import_declaration) @import',
    '(if_statement) @if',
    '(return_statement) @return',
    '(method_declaration) @method',
    '(class_declaration) @class',
    '(line_comment) @comment',
    '(block_comment) @comment',
    '(marker_annotation) @annotation',
    '(annotation) @annotation',
    `
    (
      (block_comment) @doc
      .
      (class_declaration) @class
    )
    `,
    `
    (
      (block_comment) @doc
      .
      (method_declaration) @method
    )
    `,
    `
    (
      (block_comment) @doc
      .
      (field_declaration) @variable
    )
    `,
  ],
  importQueries: [
    '(import_declaration (scoped_identifier (identifier) @import.symbol) @import.path)',
  ],
  symbolQueries: [
    '(class_declaration name: (identifier) @class.name)',
    '(method_declaration name: (identifier) @method.name)',
    '(variable_declarator (identifier) @variable.name)',
  ],
};
