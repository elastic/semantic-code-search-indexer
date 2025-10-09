// src/languages/index.ts
import { typescript } from './typescript';
import { javascript } from './javascript';
import { markdown } from './markdown';
import { yamlConfig } from './yaml';
import { javaConfig } from './java';
import { goConfig } from './go';
import { pythonConfig } from './python';
import { jsonConfig } from './json';
import { gradleConfig } from './gradle';
import { propertiesConfig } from './properties';
import { textConfig } from './text';
import { shellConfig } from './shell';

export const languageConfigurations = {
  typescript,
  javascript,
  markdown,
  yaml: yamlConfig,
  java: javaConfig,
  go: goConfig,
  python: pythonConfig,
  json: jsonConfig,
  gradle: gradleConfig,
  properties: propertiesConfig,
  text: textConfig,
  shell: shellConfig,
};
