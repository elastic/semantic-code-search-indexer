import { LanguageConfiguration } from '../utils/parser';

/**
 * Configuration for SQL language parsing with dbt/Jinja support.
 *
 * Uses a custom parser (parser: null) to handle the hybrid SQL + Jinja
 * syntax common in dbt projects. Supports:
 * - dbt ref() and source() dependency extraction
 * - Macro call detection
 * - CTE (Common Table Expression) chunking
 * - CREATE TABLE/VIEW/FUNCTION definitions
 * - Standard SQL FROM/JOIN table references
 *
 * Designed to work with multiple SQL dialects: BigQuery, Snowflake,
 * Databricks, Redshift, and DuckDB.
 */
export const sqlConfig: LanguageConfiguration = {
  name: 'sql',
  fileSuffixes: ['.sql'],
  parser: null, // Custom parser for SQL + dbt/Jinja support
  queries: [],
};
