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
 * - execute_odata: Raw OData path execution (with auto-pagination)
 * - aggregate: Perform SUM, AVG, COUNT, MIN, MAX on entity data
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

const SERVER_NAME = "Microsoft D365";
const SERVER_VERSION = "2.0.0";

/**
 * Verify D365 connectivity at startup
 */
async function verifyD365Connectivity(client: D365Client): Promise<boolean> {
  try {
    log("Verifying D365 connectivity...");
    // Make a lightweight API call to verify token and connectivity
    await client.fetchEntityList();
    log("D365 connectivity verified successfully");
    return true;
  } catch (error) {
    logError("D365 connectivity check failed", error);
    return false;
  }
}

/**
 * Create and configure the MCP server
 */
async function createServer(): Promise<{ server: McpServer; client: D365Client }> {
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

  // Verify D365 connectivity at startup
  const isConnected = await verifyD365Connectivity(client);
  if (!isConnected) {
    log("Warning: Starting server despite connectivity issues. Tools may fail until connectivity is restored.");
  }

  // Pre-load entity names for faster tool responses (fast tier)
  // Full EDMX metadata will be loaded on-demand when detailed schema is needed
  metadataCache.ensureEntityNamesLoaded().catch((err) => {
    logError("Failed to pre-load entity list (tools will retry on first use)", err);
  });

  // Register resources (for schema discovery)
  registerAllResources(server, metadataCache);

  // Register tools (for actions)
  registerAllTools(server, client, metadataCache);

  return { server, client };
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
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(server: McpServer): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    log(`Received ${signal}, shutting down gracefully...`);

    try {
      // Close the MCP server connection
      await server.close();
      log("MCP server closed successfully");
    } catch (error) {
      logError("Error during shutdown", error);
    }

    process.exit(0);
  };

  // Handle termination signals
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Handle uncaught errors gracefully
  process.on("uncaughtException", (error) => {
    logError("Uncaught exception", error);
    shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logError("Unhandled rejection", reason);
    // Don't shut down on unhandled rejection, just log it
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const { server } = await createServer();
    const transportMode = getTransportMode();

    // Setup graceful shutdown handlers
    setupGracefulShutdown(server);

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
