/**
 * Search Entity tool - robust entity search with multiple fallback strategies
 * Handles special characters like & that cause issues with D365 contains() function
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import type { EnvironmentManager } from "../environment-manager.js";
import { D365Client, D365Error } from "../d365-client.js";
import type { ODataResponse } from "../types.js";
import { ProgressReporter } from "../progress.js";
import { environmentSchema, formatEnvironmentHeader } from "./common.js";

/**
 * Default values for search
 */
const DEFAULT_TOP = 10;
const FALLBACK_FETCH_MULTIPLIER = 10;

/**
 * Search strategy used to find results
 */
type SearchStrategy = "contains" | "startswith" | "exact" | "client_filter";

/**
 * Escape special characters in OData string values
 */
function escapeODataString(value: string): string {
  // Escape single quotes by doubling them
  return value.replace(/'/g, "''");
}

/**
 * Build OData path with parameters
 */
function buildSearchPath(
  entity: string,
  filter: string,
  select?: string[],
  top?: number
): string {
  const params: string[] = [`$filter=${encodeURIComponent(filter)}`];

  if (select && select.length > 0) {
    params.push(`$select=${encodeURIComponent(select.join(","))}`);
  }

  if (top) {
    params.push(`$top=${top}`);
  }

  params.push("$count=true");

  return `/${entity}?${params.join("&")}`;
}

/**
 * Try contains() filter strategy
 */
async function tryContainsStrategy(
  client: D365Client,
  entity: string,
  searchField: string,
  searchTerm: string,
  select?: string[],
  top?: number
): Promise<{ success: boolean; records?: unknown[]; totalCount?: number; error?: string }> {
  try {
    const escapedTerm = escapeODataString(searchTerm);
    const filter = `contains(${searchField}, '${escapedTerm}')`;
    const path = buildSearchPath(entity, filter, select, top);

    const response: ODataResponse = await client.request(path);

    return {
      success: true,
      records: response.value,
      totalCount: response["@odata.count"],
    };
  } catch (error) {
    const message = error instanceof D365Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Try startswith() filter strategy
 */
async function tryStartswithStrategy(
  client: D365Client,
  entity: string,
  searchField: string,
  searchTerm: string,
  select?: string[],
  top?: number
): Promise<{ success: boolean; records?: unknown[]; totalCount?: number; error?: string }> {
  try {
    const escapedTerm = escapeODataString(searchTerm);
    const filter = `startswith(${searchField}, '${escapedTerm}')`;
    const path = buildSearchPath(entity, filter, select, top);

    const response: ODataResponse = await client.request(path);

    return {
      success: true,
      records: response.value,
      totalCount: response["@odata.count"],
    };
  } catch (error) {
    const message = error instanceof D365Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Try exact match filter strategy
 */
async function tryExactMatchStrategy(
  client: D365Client,
  entity: string,
  searchField: string,
  searchTerm: string,
  select?: string[],
  top?: number
): Promise<{ success: boolean; records?: unknown[]; totalCount?: number; error?: string }> {
  try {
    const escapedTerm = escapeODataString(searchTerm);
    const filter = `${searchField} eq '${escapedTerm}'`;
    const path = buildSearchPath(entity, filter, select, top);

    const response: ODataResponse = await client.request(path);

    return {
      success: true,
      records: response.value,
      totalCount: response["@odata.count"],
    };
  } catch (error) {
    const message = error instanceof D365Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Client-side filter fallback - fetches more records and filters locally
 */
async function tryClientSideFilter(
  client: D365Client,
  entity: string,
  searchField: string,
  searchTerm: string,
  select?: string[],
  top: number = DEFAULT_TOP,
  progress?: ProgressReporter
): Promise<{ success: boolean; records?: unknown[]; totalCount?: number; error?: string }> {
  try {
    const fetchLimit = top * FALLBACK_FETCH_MULTIPLIER;
    const searchTermLower = searchTerm.toLowerCase();

    // Ensure we include the search field in select
    const fieldsToSelect = select ? [...new Set([...select, searchField])] : undefined;

    // Build path without filter
    const params: string[] = [];
    if (fieldsToSelect && fieldsToSelect.length > 0) {
      params.push(`$select=${encodeURIComponent(fieldsToSelect.join(","))}`);
    }
    params.push(`$top=${fetchLimit}`);

    let path = `/${entity}`;
    if (params.length > 0) {
      path += `?${params.join("&")}`;
    }

    if (progress) {
      await progress.report("Server-side filtering failed, using client-side filter...");
    }

    const response: ODataResponse = await client.request(path);
    const allRecords = response.value as Record<string, unknown>[];

    // Filter client-side
    const matchedRecords = allRecords.filter((record) => {
      const fieldValue = record[searchField];
      if (typeof fieldValue !== "string") return false;
      return fieldValue.toLowerCase().includes(searchTermLower);
    });

    return {
      success: true,
      records: matchedRecords.slice(0, top),
      totalCount: matchedRecords.length,
    };
  } catch (error) {
    const message = error instanceof D365Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Format search results for output
 */
function formatSearchResults(
  records: unknown[],
  totalCount: number | undefined,
  strategy: SearchStrategy,
  entity: string,
  searchField: string,
  searchTerm: string,
  elapsedMs: number,
  envHeader: string
): string {
  const lines: string[] = [];

  // Environment header
  lines.push(envHeader);
  lines.push("");

  // Header
  lines.push(`Search Results: ${entity}`);
  lines.push(`Query: ${searchField} contains "${searchTerm}"`);
  lines.push(`Strategy: ${strategy}`);

  let summary = `Found ${records.length} result(s)`;
  if (totalCount !== undefined && totalCount > records.length) {
    summary += ` (${totalCount.toLocaleString()} total matches)`;
  }
  if (elapsedMs >= 2000) {
    summary += ` (${(elapsedMs / 1000).toFixed(1)}s)`;
  }
  lines.push(summary);
  lines.push("");

  // Records
  if (records.length > 0) {
    lines.push(JSON.stringify(records, null, 2));
  } else {
    lines.push("No matching records found.");
  }

  return lines.join("\n");
}

/**
 * Register the search_entity tool
 */
export function registerSearchEntityTool(server: McpServer, envManager: EnvironmentManager): void {
  server.tool(
    "search_entity",
    `Search for records in a D365 entity with automatic fallback strategies.

Handles special characters (like & in company names) that cause issues with standard OData contains().

Search strategies tried in order:
1. contains() - Standard OData text search (fastest)
2. startswith() - Prefix matching (more reliable on D365)
3. exact - Exact field match
4. client_filter - Fetch + client-side filter (always works)

Examples:
- Search customers: entity="CustomersV3", searchTerm="S&S", searchField="CustomerName"
- Search with specific fields: select=["CustomerAccount", "CustomerName", "CustomerGroup"]
- Search vendors: entity="VendorsV3", searchTerm="Contoso", searchField="VendorName"`,
    {
      entity: z.string().describe("Entity to search (e.g., 'CustomersV3')"),
      searchTerm: z.string().describe("Text to search for (e.g., 'S&S')"),
      searchField: z.string().describe("Field to search in (e.g., 'CustomerName')"),
      select: z.array(z.string()).optional().describe("Fields to return in results"),
      top: z.number().optional().default(DEFAULT_TOP).describe(`Maximum results to return (default: ${DEFAULT_TOP})`),
      environment: environmentSchema,
    },
    async (
      { entity, searchTerm, searchField, select, top, environment },
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>
    ) => {
      const client = envManager.getClient(environment);
      const envConfig = envManager.getEnvironmentConfig(environment);
      const startTime = Date.now();
      const progress = new ProgressReporter(server, "search_entity", extra.sessionId);

      try {
        let strategy: SearchStrategy = "contains";
        let result: { success: boolean; records?: unknown[]; totalCount?: number; error?: string };

        // Strategy 1: Try contains() first
        await progress.report("Trying contains() filter...");
        result = await tryContainsStrategy(client, entity, searchField, searchTerm, select, top);

        if (result.success && result.records && result.records.length > 0) {
          strategy = "contains";
        } else if (!result.success || (result.records && result.records.length === 0)) {
          // Strategy 2: Try startswith()
          await progress.report("Trying startswith() filter...");
          result = await tryStartswithStrategy(client, entity, searchField, searchTerm, select, top);

          if (result.success && result.records && result.records.length > 0) {
            strategy = "startswith";
          } else if (!result.success || (result.records && result.records.length === 0)) {
            // Strategy 3: Try exact match
            await progress.report("Trying exact match...");
            result = await tryExactMatchStrategy(client, entity, searchField, searchTerm, select, top);

            if (result.success && result.records && result.records.length > 0) {
              strategy = "exact";
            } else {
              // Strategy 4: Client-side filter fallback
              result = await tryClientSideFilter(
                client,
                entity,
                searchField,
                searchTerm,
                select,
                top,
                progress
              );
              strategy = "client_filter";
            }
          }
        }

        // If all strategies failed with errors
        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: `Search failed: ${result.error}\n\nAll search strategies were attempted but failed. Try using execute_odata directly or check the entity and field names.`,
              },
            ],
            isError: true,
          };
        }

        const elapsedMs = Date.now() - startTime;
        const envHeader = formatEnvironmentHeader(envConfig.name, envConfig.displayName, envConfig.type === "production");
        const output = formatSearchResults(
          result.records || [],
          result.totalCount,
          strategy,
          entity,
          searchField,
          searchTerm,
          elapsedMs,
          envHeader
        );

        return {
          content: [
            {
              type: "text",
              text: output,
            },
          ],
        };
      } catch (error) {
        let message: string;
        if (error instanceof D365Error) {
          message = error.message;
          if (error.statusCode === 404) {
            message = `Entity not found: ${entity}. Use the describe_entity tool to verify the entity name.`;
          }
        } else {
          message = `Search error: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
