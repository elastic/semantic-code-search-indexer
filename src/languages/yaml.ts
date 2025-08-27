import { LanguageConfiguration } from '../utils/parser';

export const yamlConfig: LanguageConfiguration = {
  name: 'yaml',
  fileSuffixes: ['.yml', '.yaml'],
  parser: null, // Indicates a custom parser should be used
  queries: [],
};
