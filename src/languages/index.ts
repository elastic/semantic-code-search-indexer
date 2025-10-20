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
import { LanguageConfiguration } from '../utils/parser';

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
} as const;

/**
 * Type representing all supported language names
 */
export type LanguageName = keyof typeof languageConfigurations;

/**
 * Type-safe language configurations record
 */
export type LanguageConfigurationsMap = Record<LanguageName, LanguageConfiguration>;

/**
 * Parses the SEMANTIC_CODE_INDEXER_LANGUAGES environment variable
 * and returns an array of valid language names.
 *
 * @param languagesEnv - The comma-separated string of language names
 * @returns Array of valid LanguageName values
 */
export function parseLanguageNames(languagesEnv?: string): LanguageName[] {
  const defaultLanguages: LanguageName[] = Object.keys(languageConfigurations) as LanguageName[];
  const languageString = languagesEnv || defaultLanguages.join(',');

  const parsed = languageString
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0);

  const invalid = parsed.filter(name => !(name in languageConfigurations));
  if (invalid.length > 0) {
    console.warn(`Invalid language names ignored: ${invalid.join(', ')}`);
  }

  return parsed.filter((name): name is LanguageName => name in languageConfigurations);
}
