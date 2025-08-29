import { z } from 'zod';
import { fromKueryExpression, toElasticsearchQuery } from '../../../libs/es-query';
import { client } from '../../utils/elasticsearch'; // Assuming client is exported from here
import { elasticsearchConfig } from '../../config';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';

interface SymbolAnalysisReport {
  primaryDefinitions: FileInfo[];
  typeDefinitions: FileInfo[];
  executionCallSites: FileInfo[];
  importReferences: FileInfo[];
  documentation: FileInfo[];
}

interface KindInfo {
  kind: string;
  startLines: number[];
}

interface FileInfo {
  filePath: string;
  kinds: KindInfo[];
  languages: string[];
}
export const symbolAnalysisSchema = z.object({
  symbolName: z.string().describe('The name of the symbol to analyze.'),
});

export type SymbolAnalysisParams = z.infer<typeof symbolAnalysisSchema>;

export async function symbolAnalysis(params: SymbolAnalysisParams): Promise<CallToolResult> {
  const { symbolName } = params;
  const kql = `content: "${symbolName}"`;

  const ast = fromKueryExpression(kql);
  const dsl = toElasticsearchQuery(ast);

  const response = await client.search({
    index: elasticsearchConfig.index,
    query: dsl,
    aggs: {
      files: {
        terms: {
          field: 'filePath',
          size: 1000,
        },
        aggs: {
          kinds: {
            terms: {
              field: 'kind',
              size: 100,
            },
            aggs: {
              startLines: {
                terms: {
                  field: 'startLine',
                  size: 100,
                },
              },
            },
          },
          languages: {
            terms: {
              field: 'language',
              size: 10,
            },
          },
        },
      },
    },
    size: 0,
  });

  const report: SymbolAnalysisReport = {
    primaryDefinitions: [],
    typeDefinitions: [],
    executionCallSites: [],
    importReferences: [],
    documentation: [],
  };

  if (response.aggregations) {
    const files = response.aggregations.files as any;
    for (const bucket of files.buckets) {
      const filePath = bucket.key;
      const languages = bucket.languages.buckets.map((b: any) => b.key);
      const kinds: KindInfo[] = bucket.kinds.buckets.map((b: any) => ({
        kind: b.key,
        startLines: b.startLines.buckets.map((sl: any) => sl.key),
      }));

      const fileInfo: FileInfo = {
        filePath,
        kinds,
        languages,
      };

      const allKinds = kinds.map(k => k.kind);

      if (allKinds.includes('function_declaration') || allKinds.includes('class_declaration') || allKinds.includes('lexical_declaration')) {
        report.primaryDefinitions.push(fileInfo);
      }
      if (allKinds.includes('interface_declaration') || allKinds.includes('type_alias_declaration') || allKinds.includes('enum_declaration')) {
        report.typeDefinitions.push(fileInfo);
      }
      if (allKinds.includes('call_expression')) {
        report.executionCallSites.push(fileInfo);
      }
      if (allKinds.includes('import_statement')) {
        report.importReferences.push(fileInfo);
      }
      if (languages.includes('markdown') || allKinds.includes('comment')) {
        report.documentation.push(fileInfo);
      }
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(report, null, 2) }]
  };
}
