import { LanguageConfiguration } from '../utils/parser';

export const shellConfig: LanguageConfiguration = {
  name: 'shell',
  fileSuffixes: ['.sh', '.bash', '.zsh'],
  parser: null,
  queries: [],
};
