import { McpServer as SdkServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fs from 'fs';
import path from 'path';

import { semanticCodeSearch, semanticCodeSearchSchema } from './tools/semantic_code_search.js';
import { listSymbolsByQuery, listSymbolsByQuerySchema } from './tools/list_symbols_by_query.js';
import { symbolAnalysis, symbolAnalysisSchema } from './tools/symbol_analysis.js';

export class McpServer {
  private server: SdkServer;

  constructor() {
    this.server = new SdkServer({
      name: 'code-indexer',
      version: '0.0.1',
      title: 'Code Indexer MCP Server',
    });
    this.registerTools();
  }

  private registerTools() {
    const semanticCodeSearchDescription = fs.readFileSync(path.join(__dirname, 'tools/semantic_code_search.md'), 'utf-8');
    const listSymbolsByQueryDescription = fs.readFileSync(path.join(__dirname, 'tools/list_symbols_by_query.md'), 'utf-8');
    const symbolAnalysisDescription = fs.readFileSync(path.join(__dirname, 'tools/symbol_analysis.md'), 'utf-8');

    this.server.registerTool(
      'semantic_code_search',
      {
        description: semanticCodeSearchDescription,
        inputSchema: semanticCodeSearchSchema.shape,
      },
      semanticCodeSearch
    );

    this.server.registerTool(
      'list_symbols_by_query',
      {
        description: listSymbolsByQueryDescription,
        inputSchema: listSymbolsByQuerySchema.shape,
      },
      listSymbolsByQuery
    );

    this.server.registerTool(
      'symbol_analysis',
      {
        description: symbolAnalysisDescription,
        inputSchema: symbolAnalysisSchema.shape,
      },
      symbolAnalysis
    );
  }

  public async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
