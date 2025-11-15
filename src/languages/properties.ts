import { LanguageConfiguration } from '../utils/parser';
import properties from 'tree-sitter-properties';

export const propertiesConfig: LanguageConfiguration = {
  name: 'properties',
  fileSuffixes: ['.properties'],
  parser: properties,
  queries: ['(property) @property', '(comment) @comment'],
  symbolQueries: ['(property (key) @property.key)', '(property (value) @property.value)'],
};
