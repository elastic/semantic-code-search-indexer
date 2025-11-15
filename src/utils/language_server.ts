import {
  createMessageConnection,
  InitializeRequest,
  InitializeParams,
  InitializeResult,
  MessageConnection,
  DidOpenTextDocumentNotification,
  DidOpenTextDocumentParams,
  ReferenceParams,
  ReferencesRequest,
  Location,
} from 'vscode-languageserver-protocol';
import { spawn, ChildProcess } from 'child_process';
import * as rpc from 'vscode-jsonrpc/node';
import fs from 'fs';

/**
 * A service for interacting with a TypeScript language server.
 *
 * This class is responsible for spawning a language server process,
 * initializing it, and sending requests to it.
 */
class LanguageServerService {
  private connection: MessageConnection;
  private serverProcess: ChildProcess;

  constructor() {
    this.serverProcess = spawn('npx', ['typescript-language-server', '--stdio']);
    this.connection = createMessageConnection(
      new rpc.IPCMessageReader(this.serverProcess),
      new rpc.IPCMessageWriter(this.serverProcess)
    );
    this.connection.listen();
  }

  /**
   * Initializes the language server.
   *
   * @param projectRoot The root directory of the project.
   * @returns A promise that resolves to the initialization result.
   */
  public async initialize(projectRoot: string): Promise<InitializeResult> {
    const params: InitializeParams = {
      processId: process.pid,
      rootUri: `file://${projectRoot}`,
      capabilities: {},
      trace: 'off',
    };
    return this.connection.sendRequest(InitializeRequest.type, params);
  }

  /**
   * Finds all references to a symbol at a given position in a file.
   *
   * @param filePath The path to the file.
   * @param line The line number of the symbol.
   * @param character The character number of the symbol.
   * @returns A promise that resolves to an array of locations, or null if no
   * references are found.
   */
  public async findAllReferences(filePath: string, line: number, character: number): Promise<Location[] | null> {
    const fileUri = `file://${filePath}`;

    const text = fs.readFileSync(filePath, 'utf-8');
    const openParams: DidOpenTextDocumentParams = {
      textDocument: {
        uri: fileUri,
        languageId: 'typescript',
        version: 1,
        text,
      },
    };
    this.connection.sendNotification(DidOpenTextDocumentNotification.type, openParams);

    const referenceParams: ReferenceParams = {
      textDocument: { uri: fileUri },
      position: { line, character },
      context: { includeDeclaration: true },
    };

    return this.connection.sendRequest(ReferencesRequest.type, referenceParams);
  }

  /**
   * Disposes of the language server connection and kills the process.
   */
  public dispose() {
    this.connection.dispose();
    this.serverProcess.kill();
  }
}

// We export the class directly to be instantiated by the command.
export { LanguageServerService };
