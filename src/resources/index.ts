/**
 * Resource registration module
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnvironmentManager } from "../environment-manager.js";
import { registerEntitiesResource } from "./entities.js";
import { registerEntityTemplateResource } from "./entity.js";
import { registerEnumsResource } from "./enums.js";
import { registerQueriesResource } from "./queries.js";
import { registerNavigationResource } from "./navigation.js";
import { registerDashboardResource } from "./dashboard.js";

/**
 * Register all D365 resources with the MCP server
 * Resources use the default environment's metadata cache
 */
export function registerAllResources(server: McpServer, envManager: EnvironmentManager): void {
  // Get the default environment's metadata cache
  const metadataCache = envManager.getMetadataCache();

  // Entities list resource: d365://entities?filter=<pattern>
  registerEntitiesResource(server, metadataCache);

  // Entity schema template resource: d365://entity/{entityName}
  registerEntityTemplateResource(server, metadataCache);

  // Enums resource: d365://enums
  registerEnumsResource(server, metadataCache);

  // Saved queries resource: d365://queries
  registerQueriesResource(server);

  // Navigation properties resource: d365://navigation/{entityName}
  registerNavigationResource(server, metadataCache);

  // Dashboard resource: d365://dashboard (JSON metrics for all environments)
  registerDashboardResource(server, envManager);
}
