// src/languages/index.ts
import { typescript } from './typescript';
import { javascript } from './javascript';
import { markdown } from './markdown';
import { yamlConfig } from './yaml';

export const languageConfigurations = {
  typescript,
  javascript,
  markdown,
  yaml: yamlConfig,
};
