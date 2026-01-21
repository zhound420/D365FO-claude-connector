/**
 * Entities list resource for D365
 * Static resource: d365://entities?filter=<pattern>
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import type { MetadataCache } from "../metadata-cache.js";
import { ProgressReporter } from "../progress.js";

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
    async (uri, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const progress = new ProgressReporter(server, "entities", extra.sessionId);
      await progress.report("Loading entity metadata...");

      // Parse filter from query string
      const url = new URL(uri.href);
      const filter = url.searchParams.get("filter") || undefined;

      const entities = await metadataCache.listEntities(filter);
      const elapsedMs = progress.getElapsedMs();

      const result = {
        count: entities.length,
        filter: filter || null,
        // Include timing if operation took more than 2 seconds
        ...(elapsedMs >= 2000 ? { loadTimeSeconds: parseFloat((elapsedMs / 1000).toFixed(1)) } : {}),
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
