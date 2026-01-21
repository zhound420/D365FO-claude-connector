/**
 * Entity schema template resource for D365
 * Template resource: d365://entity/{entityName}
 */

import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MetadataCache } from "../metadata-cache.js";

/**
 * Register the entity schema template resource
 */
export function registerEntityTemplateResource(server: McpServer, metadataCache: MetadataCache): void {
  const template = new ResourceTemplate("d365://entity/{entityName}", {
    list: async () => {
      const entities = await metadataCache.listEntities();
      return {
        resources: entities.map((e) => ({
          uri: `d365://entity/${e.name}`,
          name: e.name,
          description: e.description || `Schema for ${e.name} entity`,
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
          .slice(0, 50); // Limit completions
      },
    },
  });

  server.resource(
    "d365-entity-schema",
    template,
    {
      description: "Get full schema definition for a D365 entity including fields, keys, and navigation properties",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const entityName = variables.entityName as string;

      const definition = await metadataCache.getEntityDefinition(entityName);

      if (!definition) {
        // Return error as JSON
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

      const schema = {
        name: definition.name,
        description: definition.description || null,
        isCustom: definition.isCustom,
        keys: definition.keys.map((k) => ({
          name: k.name,
          fields: k.fields,
        })),
        fields: definition.fields.map((f) => ({
          name: f.name,
          type: f.type,
          nullable: f.nullable,
          maxLength: f.maxLength || null,
          precision: f.precision ?? null,
          scale: f.scale ?? null,
          isEnum: f.isEnum,
          enumTypeName: f.enumTypeName || null,
        })),
        navigationProperties: definition.navigationProperties.map((n) => ({
          name: n.name,
          targetEntity: n.targetEntity,
          isCollection: n.isCollection,
        })),
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(schema, null, 2),
          },
        ],
      };
    }
  );
}
