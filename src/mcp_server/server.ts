import { McpServer as SdkServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { randomUUID } from 'crypto';

import { semanticCodeSearch, semanticCodeSearchSchema } from './tools/semantic_code_search';
import { listSymbolsByQuery, listSymbolsByQuerySchema } from './tools/list_symbols_by_query';
import { symbolAnalysis, symbolAnalysisSchema } from './tools/symbol_analysis';
import { readFile, readFileSchema } from './tools/read_file';
import { documentSymbols, documentSymbolsSchema } from './tools/document_symbols';
import {
  createStartChainOfInvestigationHandler,
  startChainOfInvestigationSchema,
} from './prompts/chain_of_investigation';

/**
 * The main MCP server class.
 *
 * This class is responsible for creating and managing the MCP server,
 * registering tools, and starting the server with either a stdio or HTTP
 * transport.
 */
export class McpServer {
  private server: SdkServer;

  constructor() {
    this.server = new SdkServer({
      name: 'semantic-code-search',
      version: '0.0.1',
      title: 'MCP Server for the Semantic Code Search Indexer',
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

    const readFileDescription = fs.readFileSync(path.join(__dirname, 'tools/read_file.md'), 'utf-8');
    this.server.registerTool(
      'read_file_from_chunks',
      {
        description: readFileDescription,
        inputSchema: readFileSchema.shape,
      },
      readFile
    );

    const documentSymbolsDescription = fs.readFileSync(path.join(__dirname, 'tools/document_symbols.md'), 'utf-8');
    this.server.registerTool(
      'document_symbols',
      {
        description: documentSymbolsDescription,
        inputSchema: documentSymbolsSchema.shape,
      },
      documentSymbols
    );

    const chainOfInvestigationMarkdown = fs.readFileSync(
      path.join(__dirname, 'prompts/chain_of_investigation.md'),
      'utf-8'
    );

    const descriptionMatch = chainOfInvestigationMarkdown.match(/## Description\n\n(.*?)(?=\n##|$)/s);
    const description = descriptionMatch ? descriptionMatch[1].trim() : '';

    const workflowMatch = chainOfInvestigationMarkdown.match(/## Workflow\n\n(.*?)(?=\n##|$)/s);
    const workflow = workflowMatch ? workflowMatch[1].trim() : '';

    this.server.registerPrompt(
      'StartInvestigation',
      {
        description,
        argsSchema: startChainOfInvestigationSchema.shape,
      },
      createStartChainOfInvestigationHandler(workflow)
    );
  }

  /**
   * Starts the MCP server with a stdio transport.
   *
   * This is the default mode, and is used when the server is run from the
   * command line without any arguments.
   */
  public async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Starts the MCP server with an HTTP transport.
   *
   * This mode is used when the server is run with the `http` argument. It
   * creates an Express server and uses the `StreamableHTTPServerTransport`
   * to handle MCP requests over HTTP.
   *
   * @param port The port to listen on.
   */
  public async startHttp(port: number) {
    const app = express();
    app.use(express.json());
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

    app.post('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport;
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
          }
        };
        await this.server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    });

    /**
     * A reusable handler for GET and DELETE requests that require a session ID.
     *
     * @param req The Express request object.
     * @param res The Express response object.
     */
    const handleSessionRequest = async (req: express.Request, res: express.Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }

      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    };

    app.get('/mcp', handleSessionRequest);
    app.delete('/mcp', handleSessionRequest);

    app.listen(port, () => {
      console.log(`MCP HTTP server listening on port ${port}`);
    });
  }
}
