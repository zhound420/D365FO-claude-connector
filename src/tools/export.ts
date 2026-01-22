/**
 * Export tool - export query results to CSV/JSON/TSV formats
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import type { EnvironmentManager } from "../environment-manager.js";
import { D365Client, D365Error } from "../d365-client.js";
import type { ODataResponse } from "../types.js";
import { formatRecords, type ExportFormat } from "../utils/csv-utils.js";
import { formatTiming } from "../progress.js";
import { environmentSchema } from "./common.js";

/**
 * Default max records for export
 */
const DEFAULT_MAX_RECORDS = 10000;

/**
 * Execute OData request with automatic pagination for export
 */
async function fetchAllRecords(
  client: D365Client,
  entity: string,
  options: {
    select?: string[];
    filter?: string;
    orderBy?: string;
    maxRecords: number;
  }
): Promise<{
  records: Record<string, unknown>[];
  totalCount?: number;
  pagesFetched: number;
  truncated: boolean;
}> {
  const { select, filter, orderBy, maxRecords } = options;

  // Build initial query
  const queryParams: string[] = [];

  if (select && select.length > 0) {
    queryParams.push(`$select=${encodeURIComponent(select.join(","))}`);
  }

  if (filter) {
    queryParams.push(`$filter=${encodeURIComponent(filter)}`);
  }

  if (orderBy) {
    queryParams.push(`$orderby=${encodeURIComponent(orderBy)}`);
  }

  queryParams.push("$count=true");
  queryParams.push("$top=5000"); // D365 typically allows up to 5000 per page

  let path = `/${entity}`;
  if (queryParams.length > 0) {
    path += `?${queryParams.join("&")}`;
  }

  const allRecords: Record<string, unknown>[] = [];
  let pagesFetched = 0;
  let totalCount: number | undefined;
  let truncated = false;
  let nextLink: string | undefined = path;

  while (nextLink) {
    const response: ODataResponse<Record<string, unknown>> = await client.request(nextLink);
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
 * Register the export tool
 */
export function registerExportTool(server: McpServer, envManager: EnvironmentManager): void {
  server.tool(
    "export",
    `Export D365 entity data to CSV, JSON, or TSV format.

Fetches records with automatic pagination and formats the output for easy consumption.
Useful for generating reports or extracting data for analysis.

Examples:
- JSON export: entity="CustomersV3", format="json", select=["CustomerAccount", "CustomerName"]
- CSV export: entity="SalesOrderLines", format="csv", filter="SalesOrderNumber eq 'SO-001'"
- TSV with ordering: entity="Products", format="tsv", orderBy="ProductName asc", maxRecords=500
- All records (up to limit): entity="VendorsV2", format="csv", maxRecords=5000`,
    {
      entity: z.string().describe("Entity name to export (e.g., 'CustomersV3')"),
      format: z.enum(["json", "csv", "tsv"]).optional().default("json").describe(
        "Output format: json (default), csv, or tsv"
      ),
      select: z.array(z.string()).optional().describe(
        "Fields to include. Omit to include all fields."
      ),
      filter: z.string().optional().describe(
        "OData $filter expression (e.g., \"CustomerGroup eq 'US'\")"
      ),
      orderBy: z.string().optional().describe(
        "OData $orderby expression (e.g., 'CustomerName asc')"
      ),
      maxRecords: z.number().optional().default(DEFAULT_MAX_RECORDS).describe(
        `Maximum records to export (default: ${DEFAULT_MAX_RECORDS})`
      ),
      includeHeaders: z.boolean().optional().default(true).describe(
        "Include header row for CSV/TSV (default: true)"
      ),
      environment: environmentSchema,
    },
    async ({ entity, format, select, filter, orderBy, maxRecords, includeHeaders, environment }, _extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const client = envManager.getClient(environment);

      try {
        const startTime = Date.now();

        // Fetch records with pagination
        const result = await fetchAllRecords(client, entity, {
          select,
          filter,
          orderBy,
          maxRecords,
        });

        if (result.records.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No records found for ${entity}${filter ? ` with filter: ${filter}` : ""}`,
              },
            ],
          };
        }

        // Build summary
        const elapsedMs = Date.now() - startTime;
        const lines: string[] = [];
        let summary = `Exported ${result.records.length.toLocaleString()} record(s)`;
        if (result.totalCount !== undefined) {
          summary += ` of ${result.totalCount.toLocaleString()} total`;
        }
        summary += ` (${result.pagesFetched} page(s))`;
        if (result.truncated) {
          summary += ` [truncated at maxRecords=${maxRecords}]`;
        }
        // Add timing if operation took more than 2 seconds
        const timing = formatTiming(elapsedMs);
        if (timing) {
          summary += timing;
        }
        lines.push(summary);
        lines.push(`Format: ${format.toUpperCase()}`);
        lines.push("");

        // Format output based on format type
        let output: string;
        if (format === "json") {
          output = JSON.stringify(result.records, null, 2);
        } else {
          output = formatRecords(result.records, format as ExportFormat, {
            includeHeaders,
            select,
          });
        }

        lines.push(output);

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
            message = `Entity '${entity}' not found. Use d365://entities resource to list available entities.`;
          }
        } else {
          message = `Export error: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
