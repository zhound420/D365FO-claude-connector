/**
 * Get Related tool - follow entity relationships in a single call
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { D365Client, D365Error } from "../d365-client.js";
import type { MetadataCache } from "../metadata-cache.js";
import type { ODataResponse } from "../types.js";

/**
 * Default max records for related entities
 */
const DEFAULT_MAX_RECORDS = 1000;

/**
 * Build the key string for OData path
 * Supports simple keys ("US-001") and compound keys ({"DataAreaId": "usmf", "CustomerAccount": "US-001"})
 */
function buildKeyString(key: string | Record<string, unknown>): string {
  if (typeof key === "string") {
    // Simple key - quote if not already quoted
    if (key.startsWith("'") && key.endsWith("'")) {
      return `(${key})`;
    }
    return `('${key}')`;
  }

  // Compound key - build key=value pairs
  const pairs: string[] = [];
  for (const [field, value] of Object.entries(key)) {
    if (typeof value === "string") {
      pairs.push(`${field}='${value}'`);
    } else if (typeof value === "number") {
      pairs.push(`${field}=${value}`);
    } else if (value === null) {
      pairs.push(`${field}=null`);
    } else {
      pairs.push(`${field}='${String(value)}'`);
    }
  }

  return `(${pairs.join(",")})`;
}

/**
 * Build OData query parameters
 */
function buildQueryParams(options: {
  select?: string[];
  filter?: string;
  top?: number;
}): string {
  const params: string[] = [];

  if (options.select && options.select.length > 0) {
    params.push(`$select=${encodeURIComponent(options.select.join(","))}`);
  }

  if (options.filter) {
    params.push(`$filter=${encodeURIComponent(options.filter)}`);
  }

  if (options.top !== undefined && options.top > 0) {
    params.push(`$top=${options.top}`);
  }

  // Always include count for context
  params.push("$count=true");

  return params.length > 0 ? `?${params.join("&")}` : "";
}

/**
 * Register the get_related tool
 */
export function registerGetRelatedTool(
  server: McpServer,
  client: D365Client,
  metadataCache: MetadataCache
): void {
  server.tool(
    "get_related",
    `Follow entity relationships to retrieve related records in a single call.

Uses navigation properties defined in the entity schema to traverse relationships.
Use describe_entity first to see available navigation properties for an entity.

Examples:
- Get order lines for an order: entity="SalesOrderHeaders", key="SO-001", relationship="SalesOrderLines"
- With compound key: entity="SalesOrderHeaders", key={"DataAreaId": "usmf", "SalesOrderNumber": "SO-001"}, relationship="SalesOrderLines"
- With field selection: relationship="SalesOrderLines", select=["ItemNumber", "LineAmount", "Quantity"]
- With filter: relationship="SalesOrderLines", filter="LineAmount gt 1000"
- Limit results: relationship="SalesOrderLines", top=10`,
    {
      entity: z.string().describe("Source entity name (e.g., 'SalesOrderHeaders')"),
      key: z.union([
        z.string(),
        z.record(z.unknown()),
      ]).describe(
        "Primary key of source record. String for simple keys ('SO-001'), object for compound keys ({DataAreaId: 'usmf', SalesOrderNumber: 'SO-001'})"
      ),
      relationship: z.string().describe(
        "Navigation property name to follow (e.g., 'SalesOrderLines'). Use describe_entity to see available relationships."
      ),
      select: z.array(z.string()).optional().describe(
        "Fields to include from related entity. Omit to include all fields."
      ),
      filter: z.string().optional().describe(
        "OData $filter to apply to related records (e.g., 'LineAmount gt 1000')"
      ),
      top: z.number().optional().default(DEFAULT_MAX_RECORDS).describe(
        `Maximum related records to return (default: ${DEFAULT_MAX_RECORDS})`
      ),
    },
    async ({ entity, key, relationship, select, filter, top }, _extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      try {
        // Validate that the relationship exists using metadata cache
        const entityDef = await metadataCache.getEntityDefinition(entity);
        if (!entityDef) {
          return {
            content: [
              {
                type: "text",
                text: `Entity '${entity}' not found. Use d365://entities resource to list available entities.`,
              },
            ],
            isError: true,
          };
        }

        // Find the navigation property
        const navProp = entityDef.navigationProperties.find(
          (np) => np.name.toLowerCase() === relationship.toLowerCase()
        );

        if (!navProp) {
          const availableNav = entityDef.navigationProperties
            .map((np) => `  - ${np.name} → ${np.targetEntity}${np.isCollection ? " (collection)" : ""}`)
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `Navigation property '${relationship}' not found on entity '${entity}'.\n\nAvailable navigation properties:\n${availableNav || "  (none)"}`,
              },
            ],
            isError: true,
          };
        }

        // Build OData path: /Entity(key)/NavigationProperty?params
        const keyString = buildKeyString(key);
        const queryParams = buildQueryParams({ select, filter, top });
        const path = `/${entity}${keyString}/${navProp.name}${queryParams}`;

        // Execute request
        const response: ODataResponse<Record<string, unknown>> = await client.request(path);

        // Handle response
        const records = response.value || [];
        const totalCount = response["@odata.count"];

        const lines: string[] = [];

        // Build summary
        lines.push(`Related Records: ${entity} → ${navProp.name}`);
        lines.push(`Target Entity: ${navProp.targetEntity}`);

        let summary = `Found ${records.length} related record(s)`;
        if (totalCount !== undefined && totalCount > records.length) {
          summary += ` (${totalCount.toLocaleString()} total, limited by top=${top})`;
        }
        lines.push(summary);

        if (filter) {
          lines.push(`Filter: ${filter}`);
        }

        lines.push("");

        // Format records
        if (records.length === 0) {
          lines.push("(no related records found)");
        } else {
          lines.push(JSON.stringify(records, null, 2));
        }

        return {
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        let message: string;
        if (error instanceof D365Error) {
          message = error.message;
          if (error.statusCode === 404) {
            message = `Source record not found: ${entity} with key ${JSON.stringify(key)}. Verify the entity name and key values are correct.`;
          }
        } else {
          message = `Error getting related records: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
