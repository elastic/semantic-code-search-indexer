import scala from 'tree-sitter-scala';
import { LanguageConfiguration } from '../utils/parser';

export const scalaConfig: LanguageConfiguration = {
  name: 'scala',
  fileSuffixes: ['.scala'],
  parser: scala,
  queries: [
    '(import_declaration) @import',
    '(if_expression) @if',
    '(return_expression) @return',
    '(function_definition) @function',
    '(class_definition) @class',
    '(object_definition) @object',
    '(trait_definition) @trait',
    '(enum_definition) @enum',
    '(comment) @comment',
    '(block_comment) @comment',
  ],
  // Scala import paths are flat sequences of identifiers in the tree-sitter AST
  // (no single wrapper node like Java's scoped_identifier), so structured import
  // metadata extraction is not supported. Imports still appear in chunk content
  // via the (import_declaration) query above.
  symbolQueries: [
    '(class_definition name: (identifier) @class.name)',
    '(object_definition name: (identifier) @object.name)',
    '(trait_definition name: (identifier) @trait.name)',
    '(function_definition name: (identifier) @function.name)',
    '(function_declaration name: (identifier) @method.name)',
    '(val_definition pattern: (identifier) @variable.name)',
    '(var_definition pattern: (identifier) @variable.name)',
    '(call_expression function: (identifier) @function.call)',
    '(field_expression field: (identifier) @method.call)',
  ],
  exportQueries: [
    '(object_definition name: (identifier) @export.name)',
    '(class_definition name: (identifier) @export.name)',
    '(trait_definition name: (identifier) @export.name)',
    '(enum_definition name: (identifier) @export.name)',
    '(function_definition name: (identifier) @export.name)',
  ],
};
