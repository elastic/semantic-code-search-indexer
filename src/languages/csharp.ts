import path from 'path';
import { createRequire } from 'module';
import { LanguageConfiguration } from '../utils/parser';

// tree-sitter-c-sharp 0.23.5 exposes an ESM entry point with top-level await,
// while the indexer currently loads language configurations through CommonJS
// ts-node. Loading the package's native binding synchronously keeps this adapter
// local to C# and avoids changing the indexer's module system.
const requireFromHere = createRequire(__filename);
const csharpPackageJson = requireFromHere.resolve('tree-sitter-c-sharp/package.json');
const csharpPackageRoot = path.dirname(csharpPackageJson);
const requireFromCsharp = createRequire(csharpPackageJson);
const loadNativeBinding = requireFromCsharp('node-gyp-build') as (directory: string) => unknown;
const csharp = loadNativeBinding(csharpPackageRoot);

/**
 * C# language configuration for tree-sitter-c-sharp 0.23.5.
 *
 * Member declarations are the primary retrieval chunks. Type declarations are
 * retained as structural chunks so type-level documentation and inheritance are
 * searchable; Elastic's parser de-duplicates captures with identical ranges.
 */
export const csharpConfig: LanguageConfiguration = {
  name: 'csharp',
  fileSuffixes: ['.cs'],
  parser: csharp,

  queries: [
    '(using_directive) @import',
    '(class_declaration) @class',
    '(interface_declaration) @interface',
    '(struct_declaration) @struct',
    '(record_declaration) @record',
    '(enum_declaration) @enum',
    '(delegate_declaration) @delegate',
    '(method_declaration) @method',
    '(constructor_declaration) @constructor',
    '(destructor_declaration) @destructor',
    '(property_declaration) @property',
    '(indexer_declaration) @indexer',
    '(operator_declaration) @operator',
    '(conversion_operator_declaration) @conversion_operator',
    '(field_declaration) @field',
    '(event_declaration) @event',
    '(event_field_declaration) @event',
  ],

  importQueries: ['(using_directive (qualified_name) @import.path)', '(using_directive (identifier) @import.path)'],

  symbolQueries: [
    '(namespace_declaration name: (_) @namespace.name)',
    '(file_scoped_namespace_declaration name: (_) @namespace.name)',
    '(class_declaration name: (identifier) @class.name)',
    '(interface_declaration name: (identifier) @interface.name)',
    '(struct_declaration name: (identifier) @struct.name)',
    '(record_declaration name: (identifier) @record.name)',
    '(enum_declaration name: (identifier) @enum.name)',
    '(delegate_declaration name: (identifier) @delegate.name)',
    '(method_declaration name: (identifier) @method.name)',
    '(constructor_declaration name: (identifier) @constructor.name)',
    '(property_declaration name: (identifier) @property.name)',
    '(event_declaration name: (identifier) @event.name)',
    '(variable_declarator name: (identifier) @variable.name)',
    '(invocation_expression function: (identifier) @method.call)',
    '(invocation_expression function: (member_access_expression name: (identifier) @method.call))',
    '(object_creation_expression type: (_) @class.instantiation)',
    '(implicit_object_creation_expression) @class.instantiation',
  ],

  exportQueries: [
    '(class_declaration (modifier) @_visibility name: (identifier) @export.name (#eq? @_visibility "public"))',
    '(interface_declaration (modifier) @_visibility name: (identifier) @export.name (#eq? @_visibility "public"))',
    '(struct_declaration (modifier) @_visibility name: (identifier) @export.name (#eq? @_visibility "public"))',
    '(record_declaration (modifier) @_visibility name: (identifier) @export.name (#eq? @_visibility "public"))',
    '(enum_declaration (modifier) @_visibility name: (identifier) @export.name (#eq? @_visibility "public"))',
    '(delegate_declaration (modifier) @_visibility name: (identifier) @export.name (#eq? @_visibility "public"))',
    '(method_declaration (modifier) @_visibility name: (identifier) @export.name (#eq? @_visibility "public"))',
    '(constructor_declaration (modifier) @_visibility name: (identifier) @export.name (#eq? @_visibility "public"))',
    '(property_declaration (modifier) @_visibility name: (identifier) @export.name (#eq? @_visibility "public"))',
    '(event_declaration (modifier) @_visibility name: (identifier) @export.name (#eq? @_visibility "public"))',
  ],
};
