/**
 * Describe entity tool for D365 schema discovery
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MetadataCache } from "../metadata-cache.js";

/**
 * Register the describe_entity tool
 */
export function registerDescribeEntityTool(server: McpServer, metadataCache: MetadataCache): void {
  server.tool(
    "describe_entity",
    "Get the full schema definition for a D365 entity including all fields, their types, keys, and navigation properties. Use this to understand an entity's structure before querying it.",
    {
      entity: z.string().describe("The exact name of the entity to describe (e.g., 'CustomersV3', 'SalesOrderHeaders')"),
    },
    async ({ entity }) => {
      try {
        const definition = await metadataCache.getEntityDefinition(entity);

        if (!definition) {
          // Try to suggest similar entities
          const allEntities = await metadataCache.listEntities();
          const similar = allEntities
            .filter((e) => e.name.toLowerCase().includes(entity.toLowerCase()))
            .slice(0, 5)
            .map((e) => e.name);

          let message = `Entity "${entity}" not found.`;
          if (similar.length > 0) {
            message += ` Did you mean one of these?\n${similar.join("\n")}`;
          } else {
            message += " Use the d365://entities resource to discover available entities.";
          }

          return {
            content: [{ type: "text", text: message }],
            isError: true,
          };
        }

        // Format the entity definition
        const sections: string[] = [];

        // Header
        let header = `Entity: ${definition.name}`;
        if (definition.description) {
          header += `\nDescription: ${definition.description}`;
        }
        if (definition.isCustom) {
          header += "\nType: Custom Entity";
        }
        sections.push(header);

        // Keys
        if (definition.keys.length > 0) {
          const keyLines = definition.keys.map((k) => `  ${k.name}: ${k.fields.join(", ")}`);
          sections.push(`Keys:\n${keyLines.join("\n")}`);
        }

        // Fields
        if (definition.fields.length > 0) {
          const fieldLines = definition.fields.map((f) => {
            let line = `  ${f.name}: ${f.type}`;
            const attrs: string[] = [];
            if (!f.nullable) attrs.push("required");
            if (f.maxLength) attrs.push(`maxLength=${f.maxLength}`);
            if (f.precision !== undefined) attrs.push(`precision=${f.precision}`);
            if (f.scale !== undefined) attrs.push(`scale=${f.scale}`);
            if (f.isEnum) attrs.push(`enum=${f.enumTypeName}`);
            if (attrs.length > 0) {
              line += ` (${attrs.join(", ")})`;
            }
            return line;
          });
          sections.push(`Fields (${definition.fields.length}):\n${fieldLines.join("\n")}`);
        }

        // Navigation properties
        if (definition.navigationProperties.length > 0) {
          const navLines = definition.navigationProperties.map((n) => {
            const type = n.isCollection ? `Collection<${n.targetEntity}>` : n.targetEntity;
            return `  ${n.name}: ${type}`;
          });
          sections.push(`Navigation Properties:\n${navLines.join("\n")}`);
        }

        return {
          content: [
            {
              type: "text",
              text: sections.join("\n\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error describing entity: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
