/**
 * D365 Finance & Operations MCP Server v2.0
 *
 * Provides read access to D365 F&O environments through:
 *
 * Resources:
 * - d365://entities?filter=<pattern> - List entities with optional filtering
 * - d365://entity/{entityName} - Full schema for any entity
 * - d365://enums - All enum type definitions
 *
 * Tools:
 * - describe_entity: Quick schema lookup
 * - execute_odata: Raw OData path execution
 * - execute_code: Sandboxed JavaScript with D365 API access
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import {
  loadD365Config,
  getTransportMode,
  getHttpPort,
  log,
  logError,
} from "./config.js";
import { D365Client } from "./d365-client.js";
import { MetadataCache } from "./metadata-cache.js";
import { registerAllResources } from "./resources/index.js";
import { registerAllTools } from "./tools/index.js";

const SERVER_NAME = "d365fo-mcp-server";
const SERVER_VERSION = "2.0.0";

/**
 * Create and configure the MCP server
 */
function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Load D365 configuration
  const config = loadD365Config();
  log(`Connecting to D365 environment: ${config.environmentUrl}`);

  // Initialize D365 client and metadata cache
  const client = new D365Client(config);
  const metadataCache = new MetadataCache(client);

  // Register resources (for schema discovery)
  registerAllResources(server, metadataCache);

  // Register tools (for actions)
  registerAllTools(server, client, metadataCache);

  return server;
}

/**
 * Start the server with stdio transport (for Claude Code CLI)
 */
async function startStdioServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server started with stdio transport");
}

/**
 * Start the server with HTTP transport (for web/remote access)
 */
async function startHttpServer(server: McpServer): Promise<void> {
  const port = getHttpPort();
  const app = express();

  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
  });

  // MCP endpoint - handles JSON-RPC messages
  app.post("/mcp", async (req, res) => {
    try {
      // The MCP SDK expects a transport, so we need to handle messages manually
      // This is a simplified HTTP handler - in production you'd want proper session management
      const message = req.body;

      // For HTTP mode, we need to create a simple request/response handler
      // This is a basic implementation - the MCP SDK's SSE transport is better for production
      res.json({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: "HTTP transport is simplified. For full MCP support, use stdio transport with Claude Code CLI or implement SSE transport.",
        },
      });
    } catch (error) {
      logError("HTTP request error", error);
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error",
        },
      });
    }
  });

  app.listen(port, () => {
    console.log(`[D365-MCP] HTTP server listening on port ${port}`);
    console.log(`[D365-MCP] Health check: http://localhost:${port}/health`);
    console.log(`[D365-MCP] MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`[D365-MCP] Note: For full MCP functionality, use stdio transport with Claude Code CLI`);
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const server = createServer();
    const transportMode = getTransportMode();

    if (transportMode === "http") {
      await startHttpServer(server);
    } else {
      await startStdioServer(server);
    }
  } catch (error) {
    logError("Failed to start MCP server", error);
    process.exit(1);
  }
}

// Run the server
main();
