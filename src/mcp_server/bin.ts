#!/usr/bin/env node
process.env.MCP_SERVER_MODE = 'true';
import { McpServer } from './server';

const server = new McpServer();
server.start();
