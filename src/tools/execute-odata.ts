/**
 * Execute OData tool - consolidated raw OData path execution with auto-pagination
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { D365Client, D365Error } from "../d365-client.js";
import type { ODataResponse } from "../types.js";

/**
 * Default max records for auto-pagination
 */
const DEFAULT_MAX_RECORDS = 50000;

/**
 * Execute OData request with automatic pagination
 */
async function executeWithPagination(
  client: D365Client,
  initialPath: string,
  maxRecords: number
): Promise<{
  records: unknown[];
  totalCount?: number;
  pagesFetched: number;
  truncated: boolean;
}> {
  const allRecords: unknown[] = [];
  let pagesFetched = 0;
  let totalCount: number | undefined;
  let truncated = false;

  // Ensure $count=true is in the path for first request
  let currentPath = initialPath;
  if (!currentPath.includes("$count=true") && !currentPath.includes("/$count")) {
    currentPath += currentPath.includes("?") ? "&$count=true" : "?$count=true";
  }

  let nextLink: string | undefined = currentPath;

  while (nextLink) {
    const response: ODataResponse = await client.request(nextLink);
    pagesFetched++;

    // Capture total count from first response
    if (pagesFetched === 1 && response["@odata.count"] !== undefined) {
      totalCount = response["@odata.count"];
    }

    if (response.value && Array.isArray(response.value)) {
      allRecords.push(...response.value);
    }

    // Check if we've hit the max records limit
    if (allRecords.length >= maxRecords) {
      truncated = true;
      break;
    }

    nextLink = response["@odata.nextLink"];
  }

  return {
    records: allRecords.slice(0, maxRecords),
    totalCount,
    pagesFetched,
    truncated,
  };
}

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

Auto-pagination:
- Set fetchAll=true to automatically fetch all pages of results
- Use maxRecords to limit total results (default: 50,000)
- Example: path="CustomersV3", fetchAll=true, maxRecords=1000`,
    {
      path: z.string().describe(
        "OData path to execute (appended to /data/). Include entity name, keys, query parameters, etc."
      ),
      fetchAll: z.boolean().optional().default(false).describe(
        "Automatically fetch all pages of results (default: false)"
      ),
      maxRecords: z.number().optional().default(DEFAULT_MAX_RECORDS).describe(
        `Maximum records to fetch when fetchAll=true (default: ${DEFAULT_MAX_RECORDS})`
      ),
    },
    async ({ path, fetchAll, maxRecords }) => {
      try {
        // Normalize path - ensure it starts with /
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;

        // Handle auto-pagination if requested
        if (fetchAll) {
          const result = await executeWithPagination(client, normalizedPath, maxRecords);

          const lines: string[] = [];

          // Summary
          let summary = `Fetched ${result.records.length.toLocaleString()} record(s)`;
          if (result.totalCount !== undefined) {
            summary += ` of ${result.totalCount.toLocaleString()} total`;
          }
          summary += ` (${result.pagesFetched} page(s))`;
          if (result.truncated) {
            summary += ` [truncated at maxRecords=${maxRecords}]`;
          }
          lines.push(summary);
          lines.push("");

          // Records
          lines.push(JSON.stringify(result.records, null, 2));

          return {
            content: [
              {
                type: "text",
                text: lines.join("\n"),
              },
            ],
          };
        }

        // Standard single-request execution
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
              summary += " [more available - use fetchAll=true to get all pages]";
            }
            lines.push(summary);
            lines.push("");

            // Records
            lines.push(JSON.stringify(records, null, 2));

            // Next page hint
            if (nextLink) {
              lines.push("");
              lines.push(`Next page: Use path starting from "${nextLink.split("/data/")[1] || nextLink}"`);
              lines.push("Or use fetchAll=true to automatically fetch all pages");
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
