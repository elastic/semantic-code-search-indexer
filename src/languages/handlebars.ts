import { LanguageConfiguration } from '../utils/parser';

export const handlebarsConfig: LanguageConfiguration = {
  name: 'handlebars',
  fileSuffixes: ['.hbs', '.handlebars'],
  parser: null, // Indicates a custom parser should be used
  queries: [],
};

