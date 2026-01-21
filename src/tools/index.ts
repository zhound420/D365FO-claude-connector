/**
 * Tool registration module
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { D365Client } from "../d365-client.js";
import type { MetadataCache } from "../metadata-cache.js";
import { registerDescribeEntityTool } from "./describe-entity.js";
import { registerExecuteODataTool } from "./execute-odata.js";
import { registerAggregateTool } from "./aggregate.js";

/**
 * Register all D365 tools with the MCP server
 *
 * Tools:
 * - describe_entity: Quick schema lookup for any entity
 * - execute_odata: Raw OData path execution with auto-pagination support
 * - aggregate: Perform SUM, AVG, COUNT, MIN, MAX on entity data
 */
export function registerAllTools(
  server: McpServer,
  client: D365Client,
  metadataCache: MetadataCache
): void {
  // describe_entity tool: Quick schema lookup
  registerDescribeEntityTool(server, metadataCache);

  // execute_odata tool: Raw OData execution with auto-pagination
  registerExecuteODataTool(server, client);

  // aggregate tool: Aggregation operations on entity data
  registerAggregateTool(server, client);
}
