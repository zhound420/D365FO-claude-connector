/**
 * Execute OData tool - consolidated raw OData path execution
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { D365Client, D365Error } from "../d365-client.js";

/**
 * Register the execute_odata tool
 */
export function registerExecuteODataTool(server: McpServer, client: D365Client): void {
  server.tool(
    "execute_odata",
    `Execute a raw OData path against D365. The path is appended to /data/.

Examples:
- Query with parameters: "CustomersV3?$top=5&$select=CustomerAccount,CustomerName"
- Single record: "CustomersV3('US-001')" or "CustomersV3(DataAreaId='usmf',CustomerAccount='US-001')"
- Count: "CustomersV3/$count"
- Filtered count: "CustomersV3/$count?$filter=CustomerGroup eq 'US'"
- With expansion: "SalesOrderHeaders?$expand=SalesOrderLines&$top=3"

This tool consolidates query_entity and get_record functionality into a single flexible endpoint.`,
    {
      path: z.string().describe(
        "OData path to execute (appended to /data/). Include entity name, keys, query parameters, etc. Examples: 'CustomersV3?$top=10', 'CustomersV3(\\'US-001\\')', 'CustomersV3/$count'"
      ),
    },
    async ({ path }) => {
      try {
        // Normalize path - ensure it starts with /
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;

        const result = await client.request<unknown>(normalizedPath);

        // Handle different response types
        if (typeof result === "number") {
          // Count response
          return {
            content: [
              {
                type: "text",
                text: `Count: ${result.toLocaleString()}`,
              },
            ],
          };
        }

        if (result && typeof result === "object") {
          const objResult = result as Record<string, unknown>;

          // OData collection response
          if ("value" in objResult && Array.isArray(objResult.value)) {
            const records = objResult.value as unknown[];
            const count = objResult["@odata.count"] as number | undefined;
            const nextLink = objResult["@odata.nextLink"] as string | undefined;

            const lines: string[] = [];

            // Summary
            let summary = `Found ${records.length} record(s)`;
            if (count !== undefined) {
              summary += ` (total: ${count.toLocaleString()})`;
            }
            if (nextLink) {
              summary += " [more available]";
            }
            lines.push(summary);
            lines.push("");

            // Records
            lines.push(JSON.stringify(records, null, 2));

            // Next page hint
            if (nextLink) {
              lines.push("");
              lines.push(`Next page: Use path starting from "${nextLink.split("/data/")[1] || nextLink}"`);
            }

            return {
              content: [
                {
                  type: "text",
                  text: lines.join("\n"),
                },
              ],
            };
          }

          // Single record response
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        // Other response types
        return {
          content: [
            {
              type: "text",
              text: String(result),
            },
          ],
        };
      } catch (error) {
        let message: string;
        if (error instanceof D365Error) {
          message = error.message;
          if (error.statusCode === 404) {
            message = `Resource not found at path: ${path}. Verify the entity name and key values are correct.`;
          }
        } else {
          message = `Error executing OData request: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
