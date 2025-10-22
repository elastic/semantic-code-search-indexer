import { LanguageConfiguration } from '../utils/parser';
import glimmer from 'tree-sitter-glimmer';

export const handlebarsConfig: LanguageConfiguration = {
  name: 'handlebars',
  fileSuffixes: ['.hbs', '.handlebars'],
  parser: glimmer,
  queries: [
    // Capture the entire template as a single chunk
    '(template) @template',
  ],
  symbolQueries: [
    '(identifier) @variable.usage',
    '(path_expression (identifier) @variable.usage)',
    '(helper_invocation helper: (identifier) @function.call)',
    '(block_statement_start path: (identifier) @function.call)',
  ],
};

