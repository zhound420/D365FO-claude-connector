/**
 * Navigation properties resource for D365
 * Template resource: d365://navigation/{entityName}
 * Provides focused view of entity relationships for the get_related tool
 */

import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MetadataCache } from "../metadata-cache.js";

/**
 * Register the navigation properties template resource
 */
export function registerNavigationResource(server: McpServer, metadataCache: MetadataCache): void {
  const template = new ResourceTemplate("d365://navigation/{entityName}", {
    list: async () => {
      const entities = await metadataCache.listEntities();
      return {
        resources: entities.map((e) => ({
          uri: `d365://navigation/${e.name}`,
          name: `${e.name} Relationships`,
          description: `Navigation properties for ${e.name} entity`,
          mimeType: "application/json",
        })),
      };
    },
    complete: {
      entityName: async (partial: string) => {
        const entities = await metadataCache.listEntities();
        const lowerPartial = partial.toLowerCase();
        return entities
          .filter((e) => e.name.toLowerCase().startsWith(lowerPartial))
          .map((e) => e.name)
          .slice(0, 50);
      },
    },
  });

  server.resource(
    "d365-navigation",
    template,
    {
      description: "Get navigation properties (relationships) for a D365 entity. Use with get_related tool.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const entityName = variables.entityName as string;

      const definition = await metadataCache.getEntityDefinition(entityName);

      if (!definition) {
        const error = {
          error: "Entity not found",
          entityName,
          suggestion: "Use d365://entities to list available entities",
        };
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(error, null, 2),
            },
          ],
        };
      }

      // Separate collections (one-to-many) from single (many-to-one) relationships
      const collections = definition.navigationProperties
        .filter((n) => n.isCollection)
        .map((n) => ({
          name: n.name,
          targetEntity: n.targetEntity,
          type: "one-to-many",
        }));

      const references = definition.navigationProperties
        .filter((n) => !n.isCollection)
        .map((n) => ({
          name: n.name,
          targetEntity: n.targetEntity,
          type: "many-to-one",
        }));

      const result = {
        entity: entityName,
        description: definition.description || null,
        totalRelationships: definition.navigationProperties.length,
        collections: {
          description: "One-to-many relationships (use with get_related)",
          count: collections.length,
          relationships: collections,
        },
        references: {
          description: "Many-to-one relationships (parent references)",
          count: references.length,
          relationships: references,
        },
        usage: {
          tool: "get_related",
          example: collections.length > 0
            ? `get_related(entity="${entityName}", key="<key>", relationship="${collections[0].name}")`
            : null,
        },
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
