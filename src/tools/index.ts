/**
 * Tool registration module
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { D365Client } from "../d365-client.js";
import type { MetadataCache } from "../metadata-cache.js";
import { registerDescribeEntityTool } from "./describe-entity.js";
import { registerExecuteODataTool } from "./execute-odata.js";
import { registerExecuteCodeTool } from "./execute-code.js";

/**
 * Register all D365 tools with the MCP server
 *
 * Tools:
 * - describe_entity: Quick schema lookup for any entity
 * - execute_odata: Raw OData path execution (consolidates query_entity + get_record)
 * - execute_code: Sandboxed JavaScript execution with D365 API access
 */
export function registerAllTools(
  server: McpServer,
  client: D365Client,
  metadataCache: MetadataCache
): void {
  // describe_entity tool: Quick schema lookup
  registerDescribeEntityTool(server, metadataCache);

  // execute_odata tool: Raw OData execution
  registerExecuteODataTool(server, client);

  // execute_code tool: Sandboxed JavaScript with D365 API
  registerExecuteCodeTool(server, client, metadataCache);
}
