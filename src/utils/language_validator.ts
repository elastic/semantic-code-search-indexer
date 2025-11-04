// src/utils/language_validator.ts
import { LanguageConfiguration } from './parser';
import Parser from 'tree-sitter';

/**
 * Represents a validation error for a language configuration
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validates a language configuration against rules and existing configurations
 * 
 * @param config - The language configuration to validate
 * @param existingConfigs - Array of existing language configurations to check for duplicates
 * @returns Array of validation errors (empty if valid)
 */
export function validateLanguageConfiguration(
  config: LanguageConfiguration,
  existingConfigs: LanguageConfiguration[] = []
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate required fields - name
  if (!config.name) {
    errors.push({ 
      field: 'name', 
      message: 'Language name is required' 
    });
  } else if (!config.name.match(/^[a-z][a-z0-9_]*$/)) {
    errors.push({ 
      field: 'name', 
      message: 'Name must be lowercase alphanumeric with underscores, starting with a letter' 
    });
  }

  // Validate file suffixes
  if (!config.fileSuffixes || config.fileSuffixes.length === 0) {
    errors.push({ 
      field: 'fileSuffixes', 
      message: 'At least one file extension is required' 
    });
  } else {
    // Validate each file suffix format
    config.fileSuffixes.forEach((suffix, index) => {
      if (!suffix.startsWith('.')) {
        errors.push({ 
          field: `fileSuffixes[${index}]`, 
          message: `File extension "${suffix}" must start with a dot (e.g., ".ts")` 
        });
      }
      if (suffix.length < 2) {
        errors.push({ 
          field: `fileSuffixes[${index}]`, 
          message: `File extension "${suffix}" is too short (must be at least 2 characters)` 
        });
      }
    });

    // Check for duplicate extensions across languages
    existingConfigs.forEach(existingConfig => {
      if (existingConfig.name === config.name) {
        return; // Skip checking against itself
      }
      
      const duplicates = config.fileSuffixes.filter(suffix => 
        existingConfig.fileSuffixes.includes(suffix)
      );
      
      if (duplicates.length > 0) {
        errors.push({ 
          field: 'fileSuffixes', 
          message: `File extension(s) ${duplicates.join(', ')} already used by language "${existingConfig.name}"` 
        });
      }
    });
  }

  // Validate queries format if tree-sitter parser is used
  if (config.parser !== null && config.queries) {
    config.queries.forEach((query, index) => {
      if (config.parser !== null) {
        try {
          // Test if query can be created (basic syntax validation)
          // This will throw if the query syntax is invalid
          new Parser.Query(config.parser, query);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({ 
            field: `queries[${index}]`, 
            message: `Invalid query syntax: ${errorMessage}` 
          });
        }
      }
    });
  }

  // Validate parser field
  if (config.parser === undefined) {
    errors.push({ 
      field: 'parser', 
      message: 'Parser field is required (use null for custom parsers)' 
    });
  }

  return errors;
}

/**
 * Validates all language configurations in a collection
 * 
 * @param configs - Record of language configurations to validate
 * @returns Object mapping language names to their validation errors
 */
export function validateLanguageConfigurations(
  configs: Record<string, LanguageConfiguration>
): Record<string, ValidationError[]> {
  const results: Record<string, ValidationError[]> = {};
  const configArray = Object.values(configs);
  
  Object.entries(configs).forEach(([name, config]) => {
    const errors = validateLanguageConfiguration(config, configArray);
    if (errors.length > 0) {
      results[name] = errors;
    }
  });
  
  return results;
}
