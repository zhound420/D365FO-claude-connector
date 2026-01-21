/**
 * Resource registration module
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MetadataCache } from "../metadata-cache.js";
import { registerEntitiesResource } from "./entities.js";
import { registerEntityTemplateResource } from "./entity.js";
import { registerEnumsResource } from "./enums.js";
import { registerQueriesResource } from "./queries.js";

/**
 * Register all D365 resources with the MCP server
 */
export function registerAllResources(server: McpServer, metadataCache: MetadataCache): void {
  // Entities list resource: d365://entities?filter=<pattern>
  registerEntitiesResource(server, metadataCache);

  // Entity schema template resource: d365://entity/{entityName}
  registerEntityTemplateResource(server, metadataCache);

  // Enums resource: d365://enums
  registerEnumsResource(server, metadataCache);

  // Saved queries resource: d365://queries
  registerQueriesResource(server);
}
