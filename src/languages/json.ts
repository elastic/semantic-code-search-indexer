import { LanguageConfiguration } from '../utils/parser';

export const jsonConfig: LanguageConfiguration = {
  name: 'json',
  fileSuffixes: ['.json'],
  parser: null,
  parserType: 'line-based',
  metricParserType: 'json',
  queries: [],
  importQueries: [],
  symbolQueries: [],
};
