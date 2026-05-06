import { LanguageConfiguration } from '../utils/parser';

export const gradleConfig: LanguageConfiguration = {
  name: 'gradle',
  fileSuffixes: ['.gradle', '.gradle.kts'],
  parser: null,
  parserType: 'paragraph',
  queries: [],
};
