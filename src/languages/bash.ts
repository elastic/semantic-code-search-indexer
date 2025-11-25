import bash from 'tree-sitter-bash';
import { LanguageConfiguration } from '../utils/parser';

/**
 * Configuration for Bash/shell script language parsing
 *
 * This configuration uses tree-sitter for parsing and extracting code structure.
 * For more information, see: https://tree-sitter.github.io/tree-sitter/
 */
export const bashConfig: LanguageConfiguration = {
  name: 'bash',
  fileSuffixes: ['.sh', '.bash', '.zsh', '.ksh', '.bats'],
  parser: bash,

  queries: [
    '(function_definition) @function',

    // Declaration commands: export, readonly, local, declare
    '(declaration_command) @declaration',

    // Standalone variable assignments (not within declaration_command)
    '(variable_assignment) @variable',

    '(command) @command',
    '(pipeline) @pipeline',

    '(if_statement) @if',
    '(for_statement) @for',
    '(while_statement) @while',
    '(case_statement) @case',

    '(comment) @comment',
    '(file_redirect) @redirect',
    '(command_substitution) @substitution',

    // Documentation pattern: comments before functions
    `
    (
      (comment)+ @doc
      .
      (function_definition) @function
    ) @function_with_doc
    `,

    // Documentation pattern: comments before variable assignments
    `
    (
      (comment)+ @doc
      .
      (variable_assignment) @variable
    ) @variable_with_doc
    `,
  ],

  importQueries: [
    // Source statements: 'source file.sh' or '. file.sh'
    '(command name: (command_name (word) @source_cmd (#match? @source_cmd "^(source|\\.)$")) argument: (word) @import.path)',
    '(command name: (command_name (word) @source_cmd (#match? @source_cmd "^(source|\\.)$")) argument: (string (string_content) @import.path))',
  ],

  symbolQueries: [
    '(function_definition name: (word) @function.name)',
    '(variable_assignment name: (variable_name) @variable.name)',
    // Variables in declaration_command (export/readonly/local/declare)
    '(declaration_command (variable_assignment name: (variable_name) @variable.name))',
    '(command name: (command_name (word) @function.call))',
    '(simple_expansion (variable_name) @variable.usage)',
    '(expansion (variable_name) @variable.usage)',
    // Array subscripts: ${arr[@]}, ${arr[0]}
    '(subscript name: (variable_name) @variable.usage)',
  ],

  exportQueries: [
    // Captures ALL declaration_command (export/readonly/local/declare)
    // Tree-sitter can't distinguish them (keyword is unnamed node)
    // Parser.ts filters to only actual exports
    '(declaration_command (variable_assignment name: (variable_name) @export.name))',

    // Captures 'export -f funcname' - parser.ts verifies -f flag
    '(declaration_command (word) @flag (variable_name) @export.name)',
  ],
};
