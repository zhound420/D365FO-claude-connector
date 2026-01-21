/**
 * Tool registration module
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { D365Client } from "../d365-client.js";
import type { MetadataCache } from "../metadata-cache.js";
import { registerDescribeEntityTool } from "./describe-entity.js";
import { registerExecuteODataTool } from "./execute-odata.js";
import { registerAggregateTool } from "./aggregate.js";
import { registerGetRelatedTool } from "./get-related.js";
import { registerExportTool } from "./export.js";
import { registerComparePeriodsTool } from "./compare-periods.js";
import { registerTrendingTool } from "./trending.js";
import { registerSavedQueryTools } from "./saved-queries.js";
import { registerJoinEntitiesTool } from "./join-entities.js";
import { registerBatchQueryTool } from "./batch-query.js";

/**
 * Register all D365 tools with the MCP server
 *
 * Tools:
 * - describe_entity: Quick schema lookup for any entity
 * - execute_odata: Raw OData path execution with auto-pagination support
 * - aggregate: Perform SUM, AVG, COUNT, MIN, MAX on entity data
 * - get_related: Follow entity relationships to retrieve related records
 * - export: Export query results to CSV/JSON/TSV formats
 * - compare_periods: YoY, QoQ, MoM comparisons
 * - trending: Time series analysis with growth rates and moving averages
 * - save_query: Save reusable query templates
 * - execute_saved_query: Execute saved query templates
 * - delete_saved_query: Delete saved query templates
 * - join_entities: Cross-entity joins using $expand or client-side join
 * - batch_query: Execute multiple queries in parallel
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

  // get_related tool: Follow entity relationships
  registerGetRelatedTool(server, client, metadataCache);

  // export tool: Export data to CSV/JSON/TSV
  registerExportTool(server, client);

  // compare_periods tool: Period-over-period comparisons
  registerComparePeriodsTool(server, client);

  // trending tool: Time series analysis
  registerTrendingTool(server, client);

  // saved_queries tools: Save, execute, and delete query templates
  registerSavedQueryTools(server, client);

  // join_entities tool: Cross-entity joins
  registerJoinEntitiesTool(server, client, metadataCache);

  // batch_query tool: Execute multiple queries in parallel
  registerBatchQueryTool(server, client);
}
