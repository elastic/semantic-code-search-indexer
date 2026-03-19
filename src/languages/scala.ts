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
  // Scala import paths are flat identifier sequences with no single wrapper node
  // (unlike Java's scoped_identifier). Capturing the whole import_declaration node
  // and stripping the leading "import " keyword gives the full dotted path reliably.
  importQueries: ['(import_declaration) @import.path'],
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
