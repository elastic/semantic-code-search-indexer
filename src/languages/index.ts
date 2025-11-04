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
import { handlebarsConfig } from './handlebars';
import { cConfig } from './c';
import { cppConfig } from './cpp';
import { LanguageConfiguration } from '../utils/parser';
import { validateLanguageConfiguration, validateLanguageConfigurations, ValidationError } from '../utils/language_validator';

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
  handlebars: handlebarsConfig,
  c: cConfig,
  cpp: cppConfig,
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

/**
 * Validates and registers a new language configuration
 * 
 * @param config - The language configuration to register
 * @param existingConfigs - Existing configurations to check against
 * @returns Validation errors if any, empty array if valid
 */
export function registerLanguage(
  config: LanguageConfiguration,
  existingConfigs: LanguageConfiguration[] = Object.values(languageConfigurations)
): ValidationError[] {
  const errors = validateLanguageConfiguration(config, existingConfigs);
  if (errors.length > 0) {
    console.warn(`Language configuration "${config.name}" has validation errors:`);
    errors.forEach(error => {
      console.warn(`  - ${error.field}: ${error.message}`);
    });
  }
  return errors;
}

/**
 * Validates all language configurations on startup
 * Logs warnings for any invalid configurations but does not prevent startup
 * 
 * @returns Object mapping language names to their validation errors
 */
export function validateAllLanguageConfigurations(): Record<string, ValidationError[]> {
  const configs: Record<string, LanguageConfiguration> = {};
  for (const [key, value] of Object.entries(languageConfigurations)) {
    configs[key] = value;
  }
  
  const results = validateLanguageConfigurations(configs);
  
  if (Object.keys(results).length > 0) {
    console.warn('Language configuration validation warnings:');
    Object.entries(results).forEach(([name, errors]) => {
      console.warn(`\n  Language: ${name}`);
      errors.forEach(error => {
        console.warn(`    - ${error.field}: ${error.message}`);
      });
    });
  }
  
  return results;
}

// Export validation utilities for use in other modules
export { validateLanguageConfiguration, validateLanguageConfigurations, ValidationError };
