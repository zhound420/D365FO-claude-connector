/**
 * Enum definitions resource for D365
 * Static resource: d365://enums
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MetadataCache } from "../metadata-cache.js";

/**
 * Register the enums resource
 */
export function registerEnumsResource(server: McpServer, metadataCache: MetadataCache): void {
  server.resource(
    "d365-enums",
    "d365://enums",
    {
      description: "List all D365 enum type definitions with their values. Useful for understanding valid enum values for filtering and interpreting query results.",
      mimeType: "application/json",
    },
    async (uri) => {
      const enums = await metadataCache.listEnums();

      const result = {
        count: enums.length,
        enums: enums.map((e) => ({
          name: e.name,
          fullName: e.fullName,
          members: e.members.map((m) => ({
            name: m.name,
            value: m.value,
          })),
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
