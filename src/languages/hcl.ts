import hcl from '@tree-sitter-grammars/tree-sitter-hcl';
import { LanguageConfiguration } from '../utils/parser';

export const hclConfig: LanguageConfiguration = {
  name: 'hcl',
  fileSuffixes: ['.tf', '.hcl'],
  parser: hcl,
  queries: ['(block) @block', '(attribute) @attribute', '(function_call) @function_call', '(comment) @comment'],
  symbolQueries: [
    '(block (identifier) @block.type)',
    '(block (string_lit (template_literal) @block.label))',
    '(attribute (identifier) @attribute.name)',
    '(function_call (identifier) @function.call)',
  ],
};
