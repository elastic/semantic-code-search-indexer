// src/commands/scaffold_language_command.ts
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { languageConfigurations } from '../languages';
import { validateLanguageConfiguration } from '../utils/language_validator';
import { LanguageConfiguration } from '../utils/parser';

interface ScaffoldOptions {
  name?: string;
  extensions?: string;
  parser?: string;
  custom?: boolean;
  register?: boolean;
}

/**
 * Generates a language configuration file from a template
 */
async function scaffoldLanguage(options: ScaffoldOptions) {
  try {
    // Validate required options
    if (!options.name) {
      console.error('Error: --name is required');
      console.log('Usage: scaffold-language --name <language> --extensions <extensions>');
      console.log('Example: scaffold-language --name rust --extensions ".rs,.rlib" --parser tree-sitter-rust');
      process.exit(1);
    }

    if (!options.extensions) {
      console.error('Error: --extensions is required');
      console.log('Usage: scaffold-language --name <language> --extensions <extensions>');
      console.log('Example: scaffold-language --name rust --extensions ".rs,.rlib" --parser tree-sitter-rust');
      process.exit(1);
    }

    const languageName = options.name.toLowerCase();
    const isCustomParser = options.custom || !options.parser;
    const shouldRegister = options.register !== false; // Default to true

    // Validate language name format
    if (!languageName.match(/^[a-z][a-z0-9_]*$/)) {
      console.error('Error: Language name must be lowercase alphanumeric with underscores, starting with a letter');
      process.exit(1);
    }

    // Check if language already exists
    if (languageName in languageConfigurations) {
      console.error(`Error: Language "${languageName}" already exists in src/languages/index.ts`);
      process.exit(1);
    }

    // Parse and validate file extensions
    const extensions = options.extensions
      .split(',')
      .map((ext) => ext.trim())
      .filter((ext) => ext.length > 0);

    if (extensions.length === 0) {
      console.error('Error: At least one file extension is required');
      process.exit(1);
    }

    // Ensure extensions start with a dot
    const validExtensions = extensions.map((ext) => {
      if (!ext.startsWith('.')) {
        return `.${ext}`;
      }
      return ext;
    });

    // Determine file path and names
    const languagesDir = path.join(process.cwd(), 'src', 'languages');
    const fileName = `${languageName}.ts`;
    const filePath = path.join(languagesDir, fileName);

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      console.error(`Error: File ${filePath} already exists`);
      process.exit(1);
    }

    // Generate configuration content
    const configVarName = `${languageName}Config`;
    const extensionsString = validExtensions.map((ext) => `'${ext}'`).join(', ');

    let content: string;

    if (isCustomParser) {
      // Use custom parser template
      try {
        const template = fs.readFileSync(path.join(languagesDir, 'templates', 'custom-parser-template.txt'), 'utf-8');
        content = template
          .replace(/\{\{LANGUAGE_NAME\}\}/g, languageName)
          .replace(/\{\{FILE_EXTENSIONS\}\}/g, extensionsString);
      } catch (error) {
        console.error('Error: Could not read custom parser template file');
        console.error('Make sure src/languages/templates/custom-parser-template.txt exists');
        throw error;
      }
    } else {
      // Use tree-sitter template
      try {
        const template = fs.readFileSync(path.join(languagesDir, 'templates', 'tree-sitter-template.txt'), 'utf-8');

        // Determine package variable name (e.g., tree-sitter-rust -> rust)
        const packageVarName = options.parser!.replace('tree-sitter-', '');

        content = template
          .replace(/\{\{LANGUAGE_NAME\}\}/g, languageName)
          .replace(/\{\{FILE_EXTENSIONS\}\}/g, extensionsString)
          .replace(/\{\{TREE_SITTER_PACKAGE\}\}/g, options.parser!)
          .replace(/\{\{TREE_SITTER_PACKAGE_VAR\}\}/g, packageVarName);
      } catch (error) {
        console.error('Error: Could not read tree-sitter template file');
        console.error('Make sure src/languages/templates/tree-sitter-template.txt exists');
        throw error;
      }
    }

    // Write the configuration file
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ Created language configuration: ${filePath}`);

    // Validate the generated configuration
    const mockConfig: LanguageConfiguration = {
      name: languageName,
      fileSuffixes: validExtensions,
      parser: null,
      queries: [],
    };

    const existingConfigs = Object.values(languageConfigurations);
    const validationErrors = validateLanguageConfiguration(mockConfig, existingConfigs);

    if (validationErrors.length > 0) {
      console.log('\n⚠ Validation warnings for generated configuration:');
      validationErrors.forEach((error) => {
        console.log(`  - ${error.field}: ${error.message}`);
      });
    }

    // Update index.ts if requested
    if (shouldRegister) {
      const indexPath = path.join(languagesDir, 'index.ts');
      const indexContent = fs.readFileSync(indexPath, 'utf-8');

      // Add import statement
      const importStatement = `import { ${configVarName} } from './${languageName}';`;

      // Find the last import statement
      const lines = indexContent.split('\n');
      let lastImportIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('import ')) {
          lastImportIndex = i;
        }
      }

      if (lastImportIndex === -1) {
        console.warn('Warning: Could not find import statements in index.ts');
      } else {
        // Insert import after last import
        lines.splice(lastImportIndex + 1, 0, importStatement);

        // Add to languageConfigurations object
        const configsStartIndex = lines.findIndex((line) => line.includes('export const languageConfigurations'));

        if (configsStartIndex === -1) {
          console.warn('Warning: Could not find languageConfigurations export in index.ts');
        } else {
          // Find the closing brace of languageConfigurations
          let braceCount = 0;
          let configsEndIndex = -1;
          for (let i = configsStartIndex; i < lines.length; i++) {
            for (const char of lines[i]) {
              if (char === '{') braceCount++;
              if (char === '}') braceCount--;
              if (braceCount === 0 && char === '}') {
                configsEndIndex = i;
                break;
              }
            }
            if (configsEndIndex !== -1) break;
          }

          if (configsEndIndex === -1) {
            console.warn('Warning: Could not find end of languageConfigurations in index.ts');
          } else {
            // Insert before the closing brace
            const registrationLine = `  ${languageName}: ${configVarName},`;
            lines.splice(configsEndIndex, 0, registrationLine);

            // Write updated index.ts
            fs.writeFileSync(indexPath, lines.join('\n'), 'utf-8');
            console.log(`✓ Updated ${indexPath} with language registration`);
          }
        }
      }
    }

    // Print next steps
    console.log('\nNext steps:');
    console.log(`1. Edit ${filePath} to add tree-sitter queries for your language`);
    if (!isCustomParser && options.parser) {
      console.log(`2. Install the tree-sitter package: npm install ${options.parser}`);
      console.log('3. Add the package to dependencies in package.json');
    }
    console.log(
      `${isCustomParser || !options.parser ? '2' : '4'}. Test the configuration with: npm run dump-tree <file-path>`
    );
    console.log(`${isCustomParser || !options.parser ? '3' : '5'}. Build and run tests: npm run build && npm test`);
  } catch (error) {
    console.error('An error occurred:', error);
    process.exit(1);
  }
}

export const scaffoldLanguageCommand = new Command('scaffold-language')
  .description('Generate a new language configuration file')
  .option('--name <name>', 'Language name (lowercase, no spaces)')
  .option('--extensions <extensions>', 'File extensions (comma-separated, e.g., ".rs,.rlib")')
  .option('--parser <parser>', 'Tree-sitter package name (e.g., tree-sitter-rust)')
  .option('--custom', 'Use custom parser (no tree-sitter)')
  .option('--no-register', 'Skip auto-registration in index.ts')
  .action(scaffoldLanguage);
