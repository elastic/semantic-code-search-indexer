// tests/unit/parser-sql.test.ts
// SQL Parser Tests
import { describe, it, expect } from 'vitest';
import path from 'path';
import { LanguageParser } from '../../src/utils/parser';

describe('SQL Parser', () => {
  const parser = new LanguageParser();

  describe('dbt Model Parsing', () => {
    it('should parse SQL dbt model fixtures correctly', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_dbt_model.sql');
      const result = parser.parseFile(filePath, 'main', 'models/staging/stg_orders.sql');

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.metrics.language).toBe('sql');
      expect(result.metrics.parserType).toBe('sql');
    });

    it('should extract ref() dependencies from dbt models', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_dbt_model.sql');
      const result = parser.parseFile(filePath, 'main', 'models/staging/stg_orders.sql');

      const allSymbols = result.chunks.flatMap((chunk) => chunk.symbols || []);
      expect(allSymbols).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'dim_customers', kind: 'sql.ref' })])
      );
    });

    it('should extract source() dependencies from dbt models', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_dbt_model.sql');
      const result = parser.parseFile(filePath, 'main', 'models/staging/stg_orders.sql');

      const allImports = result.chunks.flatMap((chunk) => chunk.imports || []);
      expect(allImports).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'source:ecom.raw_orders' })]));
    });

    it('should extract macro call dependencies from dbt models', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_dbt_model.sql');
      const result = parser.parseFile(filePath, 'main', 'models/staging/stg_orders.sql');

      const allSymbols = result.chunks.flatMap((chunk) => chunk.symbols || []);
      expect(allSymbols).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'cents_to_dollars', kind: 'sql.macro' })])
      );
    });

    it('should create CTE chunks for WITH clauses', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_dbt_model.sql');
      const result = parser.parseFile(filePath, 'main', 'models/staging/stg_orders.sql');

      const cteChunks = result.chunks.filter((c) => c.kind === 'cte');
      expect(cteChunks.length).toBeGreaterThan(0);

      // Check that CTE names are captured
      const cteNames = cteChunks.map((c) => c.containerPath);
      expect(cteNames).toEqual(expect.arrayContaining(['source', 'cleaned', 'final']));
    });

    it('should create config chunk for dbt config block', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_dbt_model.sql');
      const result = parser.parseFile(filePath, 'main', 'models/staging/stg_orders.sql');

      const configChunks = result.chunks.filter((c) => c.kind === 'config');
      expect(configChunks.length).toBe(1);
      expect(configChunks[0].content).toContain("config(materialized='view')");
    });
  });

  describe('dbt Macro Parsing', () => {
    it('should parse SQL dbt macro fixtures correctly', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_dbt_macro.sql');
      const result = parser.parseFile(filePath, 'main', 'macros/cents_to_dollars.sql');

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.metrics.language).toBe('sql');
      expect(result.metrics.parserType).toBe('sql');
    });

    it('should extract macro definitions', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_dbt_macro.sql');
      const result = parser.parseFile(filePath, 'main', 'macros/cents_to_dollars.sql');

      const macroChunks = result.chunks.filter((c) => c.kind === 'macro');
      expect(macroChunks.length).toBe(5); // cents_to_dollars, default__, postgres__, bigquery__, snowflake__

      // Check macro names are captured
      const macroNames = macroChunks.map((c) => c.containerPath);
      expect(macroNames).toEqual(
        expect.arrayContaining([
          'cents_to_dollars',
          'default__cents_to_dollars',
          'postgres__cents_to_dollars',
          'bigquery__cents_to_dollars',
          'snowflake__cents_to_dollars',
        ])
      );
    });

    it('should set correct line numbers for macros', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_dbt_macro.sql');
      const result = parser.parseFile(filePath, 'main', 'macros/cents_to_dollars.sql');

      const macroChunks = result.chunks.filter((c) => c.kind === 'macro');
      expect(macroChunks.length).toBeGreaterThan(0);

      // First macro should start at line 3 (after the comment)
      expect(macroChunks[0].startLine).toBe(3);
      expect(macroChunks[0].endLine).toBeGreaterThan(macroChunks[0].startLine);

      // Each subsequent macro should start after the previous one ends
      for (let i = 1; i < macroChunks.length; i++) {
        expect(macroChunks[i].startLine).toBeGreaterThan(macroChunks[i - 1].endLine);
      }
    });

    it('should have dependency line numbers within macro chunk boundaries', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_dbt_macro.sql');
      const result = parser.parseFile(filePath, 'main', 'macros/cents_to_dollars.sql');

      const macroChunks = result.chunks.filter((c) => c.kind === 'macro');

      // Verify that all symbol line numbers fall within the chunk's line range
      for (const chunk of macroChunks) {
        const symbols = chunk.symbols || [];
        for (const symbol of symbols) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const line = Number((symbol as any).line);
          expect(line).toBeGreaterThanOrEqual(chunk.startLine);
          expect(line).toBeLessThanOrEqual(chunk.endLine);
        }
      }
    });
  });

  describe('Pure SQL Parsing', () => {
    it('should parse pure SQL fixtures correctly', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_pure.sql');
      const result = parser.parseFile(filePath, 'main', 'migrations/create_users.sql');

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.metrics.language).toBe('sql');
      expect(result.metrics.parserType).toBe('sql');
    });

    it('should parse CREATE TABLE statements', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_pure.sql');
      const result = parser.parseFile(filePath, 'main', 'migrations/create_users.sql');

      const createChunks = result.chunks.filter((c) => c.content.toLowerCase().includes('create table'));
      expect(createChunks.length).toBeGreaterThan(0);
    });

    it('should parse CREATE VIEW statements', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_pure.sql');
      const result = parser.parseFile(filePath, 'main', 'migrations/create_users.sql');

      // Check that all chunks together contain the CREATE VIEW statement
      const allContent = result.chunks.map((c) => c.content).join('\n');
      expect(allContent.toLowerCase()).toContain('create view');
    });

    it('should parse CTEs in pure SQL', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_pure.sql');
      const result = parser.parseFile(filePath, 'main', 'queries/report.sql');

      const cteChunks = result.chunks.filter((c) => c.kind === 'cte');
      expect(cteChunks.length).toBeGreaterThan(0);

      // Check CTE names
      const cteNames = cteChunks.map((c) => c.containerPath);
      expect(cteNames).toEqual(expect.arrayContaining(['active_users', 'recent_orders', 'order_summary']));
    });

    it('should extract table references from FROM/JOIN clauses', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_pure.sql');
      const result = parser.parseFile(filePath, 'main', 'queries/report.sql');

      const allSymbols = result.chunks.flatMap((chunk) => chunk.symbols || []);
      const tableSymbols = allSymbols.filter((s) => s.kind === 'sql.table');

      expect(tableSymbols.length).toBeGreaterThan(0);
      expect(tableSymbols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'users', kind: 'sql.table' }),
          expect.objectContaining({ name: 'orders', kind: 'sql.table' }),
        ])
      );
    });
  });

  describe('SQL File Extension Recognition', () => {
    it('should recognize .sql file extension', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_pure.sql');
      const result = parser.parseFile(filePath, 'main', 'test.sql');
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.chunks[0].language).toBe('sql');
    });
  });

  describe('SQL Directory Information', () => {
    it('should extract directory information correctly for SQL files', () => {
      const filePath = path.resolve(__dirname, '../fixtures/sql_dbt_model.sql');
      const result = parser.parseFile(filePath, 'main', 'models/staging/stg_orders.sql');

      expect(result.chunks.length).toBeGreaterThan(0);
      result.chunks.forEach((chunk) => {
        expect(chunk.directoryPath).toBe('models/staging');
        expect(chunk.directoryName).toBe('staging');
        expect(chunk.directoryDepth).toBe(2);
      });
    });
  });
});
