import { LanguageConfiguration } from '../utils/parser';
import sql from '@derekstride/tree-sitter-sql';

export const plpgsqlConfig: LanguageConfiguration = {
  name: 'plpgsql',
  fileSuffixes: ['.sql', '.pgsql', '.plpgsql'],
  parser: sql,
  queries: [
    '(create_function) @function',
    '(create_table) @table',
    '(create_type) @type',
    '(create_view) @view',
    '(invocation) @call',
    '(comment_statement) @comment',
    '(comment) @comment',
  ],
  // This grammar currently does not expose a stable create_procedure node.
  // CREATE PROCEDURE commonly parses as ERROR, so procedure extraction is out of scope.
  symbolQueries: [
    '(create_function (object_reference name: (identifier) @function.name))',
    '(create_table (object_reference name: (identifier) @table.name))',
    '(create_type (object_reference name: (identifier) @type.name))',
    '(create_view (object_reference name: (identifier) @view.name))',
    '(invocation (object_reference name: (identifier) @function.call))',
  ],
  exportQueries: [
    '(create_function (object_reference name: (identifier) @export.name))',
    '(create_table (object_reference name: (identifier) @export.name))',
    '(create_type (object_reference name: (identifier) @export.name))',
    '(create_view (object_reference name: (identifier) @export.name))',
  ],
  // Omitted importQueries intentionally: SQL/PLpgSQL set/search-path/schema references do not map
  // cleanly to canonical module/file imports in this parser, similar to Scala's limitations.
};
