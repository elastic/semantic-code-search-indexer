// src/languages/markdown.ts
import { LanguageConfiguration } from '../utils/parser';

export const markdown: LanguageConfiguration = {
  name: 'markdown',
  fileSuffixes: ['.md', '.mdx'],
  parser: null, // Markdown is not parsed with tree-sitter in the same way
  queries: [],
};
