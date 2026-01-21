/**
 * Entities list resource for D365
 * Static resource: d365://entities?filter=<pattern>
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MetadataCache } from "../metadata-cache.js";

/**
 * Register the entities list resource
 */
export function registerEntitiesResource(server: McpServer, metadataCache: MetadataCache): void {
  server.resource(
    "d365-entities",
    "d365://entities",
    {
      description: "List all D365 entities. Use ?filter= query parameter with wildcards (* for any chars, ? for single char) to filter. Example: d365://entities?filter=Cust*",
      mimeType: "application/json",
    },
    async (uri) => {
      // Parse filter from query string
      const url = new URL(uri.href);
      const filter = url.searchParams.get("filter") || undefined;

      const entities = await metadataCache.listEntities(filter);

      const result = {
        count: entities.length,
        filter: filter || null,
        entities: entities.map((e) => ({
          name: e.name,
          description: e.description || null,
          isCustom: e.isCustom,
        })),
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
