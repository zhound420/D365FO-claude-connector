/**
 * D365 Finance & Operations MCP Server v3.0
 *
 * Provides multi-environment support with read/write capabilities:
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
 * - list_environments: List all configured environments
 * - create_record: Create new records (non-production only)
 * - update_record: Update existing records (non-production only)
 * - delete_record: Delete records (non-production only)
 *
 * All tools support an optional 'environment' parameter to target specific environments.
 * Production environments are always read-only.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import {
  getTransportMode,
  getHttpPort,
  log,
  logError,
} from "./config.js";
import { EnvironmentManager } from "./environment-manager.js";
import { registerAllResources } from "./resources/index.js";
import { registerAllTools } from "./tools/index.js";

const SERVER_VERSION = "3.0.0";

/**
 * Generate dynamic server name based on environment configuration
 */
function getServerName(envManager: EnvironmentManager): string {
  const environments = envManager.getEnvironments();
  const isSingleEnvMode = environments.length === 1;

  if (isSingleEnvMode) {
    const env = environments[0];
    const emoji = env.type === "production" ? "🔴" : "🟢";
    return `D365 ${env.displayName} ${emoji}`;
  }

  return "Microsoft D365";
}

/**
 * Create and configure the MCP server
 */
async function createServer(): Promise<{ server: McpServer; envManager: EnvironmentManager; serverName: string }> {
  // Initialize environment manager first (loads all environment configs)
  const envManager = new EnvironmentManager();

  // Create server with dynamic name based on environment
  const serverName = getServerName(envManager);
  const server = new McpServer({
    name: serverName,
    version: SERVER_VERSION,
  });

  // Log configured environments
  const environments = envManager.getEnvironments();
  log(`Configured ${environments.length} environment(s):`);
  for (const env of environments) {
    const writeStatus = env.type === "production" ? "read-only" : "read/write";
    const defaultMarker = env.default ? " [default]" : "";
    log(`  - ${env.displayName} (${env.name}): ${env.type} [${writeStatus}]${defaultMarker}`);
  }

  // Verify connectivity for the default environment
  const defaultEnvName = envManager.getDefaultEnvironmentName();
  const isConnected = await envManager.verifyConnectivity(defaultEnvName);
  if (!isConnected) {
    log("Warning: Starting server despite connectivity issues with default environment. Tools may fail until connectivity is restored.");
  } else {
    log(`Default environment connectivity verified: ${defaultEnvName}`);
  }

  // Pre-load entity names for the default environment
  const defaultCache = envManager.getMetadataCache(defaultEnvName);
  defaultCache.ensureEntityNamesLoaded().catch((err) => {
    logError("Failed to pre-load entity list for default environment (tools will retry on first use)", err);
  });

  // Register resources (for schema discovery)
  registerAllResources(server, envManager);

  // Register tools (for actions)
  registerAllTools(server, envManager);

  return { server, envManager, serverName };
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
async function startHttpServer(server: McpServer, serverName: string): Promise<void> {
  const port = getHttpPort();
  const app = express();

  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: serverName, version: SERVER_VERSION });
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
    const { server, serverName } = await createServer();
    const transportMode = getTransportMode();

    // Setup graceful shutdown handlers
    setupGracefulShutdown(server);

    if (transportMode === "http") {
      await startHttpServer(server, serverName);
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
