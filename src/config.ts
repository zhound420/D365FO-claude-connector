/**
 * Environment configuration loader for D365 MCP Server
 */

import type { D365Config, TransportMode } from "./types.js";

/**
 * Load and validate D365 configuration from environment variables
 */
export function loadD365Config(): D365Config {
  const tenantId = process.env.D365_TENANT_ID;
  const clientId = process.env.D365_CLIENT_ID;
  const clientSecret = process.env.D365_CLIENT_SECRET;
  let environmentUrl = process.env.D365_ENVIRONMENT_URL;

  if (!tenantId) {
    throw new Error("D365_TENANT_ID environment variable is required");
  }
  if (!clientId) {
    throw new Error("D365_CLIENT_ID environment variable is required");
  }
  if (!clientSecret) {
    throw new Error("D365_CLIENT_SECRET environment variable is required");
  }
  if (!environmentUrl) {
    throw new Error("D365_ENVIRONMENT_URL environment variable is required");
  }

  // Remove trailing slash from environment URL (D365 requirement)
  environmentUrl = environmentUrl.replace(/\/+$/, "");

  return {
    tenantId,
    clientId,
    clientSecret,
    environmentUrl,
  };
}

/**
 * Get the transport mode from environment
 */
export function getTransportMode(): TransportMode {
  const mode = process.env.MCP_TRANSPORT?.toLowerCase();
  if (mode === "http") {
    return "http";
  }
  return "stdio";
}

/**
 * Get HTTP port for HTTP transport mode
 */
export function getHttpPort(): number {
  const port = process.env.MCP_HTTP_PORT;
  if (port) {
    const parsed = parseInt(port, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
  }
  return 3000;
}

/**
 * Check if we're in stdio mode (affects logging)
 */
export function isStdioMode(): boolean {
  return getTransportMode() === "stdio";
}

/**
 * Safe logging function that only outputs in non-stdio mode
 * In stdio mode, use console.error for diagnostic output
 */
export function log(message: string, ...args: unknown[]): void {
  if (isStdioMode()) {
    console.error(`[D365-MCP] ${message}`, ...args);
  } else {
    console.log(`[D365-MCP] ${message}`, ...args);
  }
}

/**
 * Error logging (always goes to stderr)
 */
export function logError(message: string, error?: unknown): void {
  console.error(`[D365-MCP ERROR] ${message}`, error ?? "");
}
