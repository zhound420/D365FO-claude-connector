/**
 * Tool registration module
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnvironmentManager } from "../environment-manager.js";
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
import { registerSearchEntityTool } from "./search-entity.js";
import { registerAnalyzeCustomerTool } from "./analyze-customer.js";
import { registerListEnvironmentsTool } from "./list-environments.js";
import { registerSetEnvironmentTool } from "./set-environment.js";
import { registerCreateRecordTool } from "./create-record.js";
import { registerUpdateRecordTool } from "./update-record.js";
import { registerDeleteRecordTool } from "./delete-record.js";
import { registerDashboardTool } from "./dashboard.js";

/**
 * Register all D365 tools with the MCP server
 *
 * Tools:
 * - list_environments: List all configured D365 environments
 * - set_environment: Set the working environment for the conversation
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
 * - search_entity: Robust entity search with automatic fallback strategies
 * - analyze_customer: Comprehensive single-call customer analysis
 * - create_record: Create new records (non-production only)
 * - update_record: Update existing records (non-production only)
 * - delete_record: Delete records (non-production only)
 * - dashboard: Display comprehensive environment dashboard with health and metrics
 *
 * All tools support an optional 'environment' parameter to target specific environments.
 */
export function registerAllTools(
  server: McpServer,
  envManager: EnvironmentManager
): void {
  // list_environments tool: Show all configured environments
  registerListEnvironmentsTool(server, envManager);

  // set_environment tool: Set working environment for conversation
  registerSetEnvironmentTool(server, envManager);

  // describe_entity tool: Quick schema lookup
  registerDescribeEntityTool(server, envManager);

  // execute_odata tool: Raw OData execution with auto-pagination
  registerExecuteODataTool(server, envManager);

  // aggregate tool: Aggregation operations on entity data
  registerAggregateTool(server, envManager);

  // get_related tool: Follow entity relationships
  registerGetRelatedTool(server, envManager);

  // export tool: Export data to CSV/JSON/TSV
  registerExportTool(server, envManager);

  // compare_periods tool: Period-over-period comparisons
  registerComparePeriodsTool(server, envManager);

  // trending tool: Time series analysis
  registerTrendingTool(server, envManager);

  // saved_queries tools: Save, execute, and delete query templates
  registerSavedQueryTools(server, envManager);

  // join_entities tool: Cross-entity joins
  registerJoinEntitiesTool(server, envManager);

  // batch_query tool: Execute multiple queries in parallel
  registerBatchQueryTool(server, envManager);

  // search_entity tool: Robust entity search with fallback strategies
  registerSearchEntityTool(server, envManager);

  // analyze_customer tool: Comprehensive single-call customer analysis
  registerAnalyzeCustomerTool(server, envManager);

  // Write tools (non-production only)
  registerCreateRecordTool(server, envManager);
  registerUpdateRecordTool(server, envManager);
  registerDeleteRecordTool(server, envManager);

  // Dashboard tool: Environment status and metrics
  registerDashboardTool(server, envManager);
}
