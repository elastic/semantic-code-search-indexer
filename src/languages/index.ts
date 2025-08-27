// src/languages/index.ts
import { typescript } from './typescript';
import { javascript } from './javascript';
import { markdown } from './markdown';
import { yamlConfig } from './yaml';
import { javaConfig } from './java';
import { goConfig } from './go';
import { pythonConfig } from './python';

export const languageConfigurations = {
  typescript,
  javascript,
  markdown,
  yaml: yamlConfig,
  java: javaConfig,
  go: goConfig,
  python: pythonConfig,
};
