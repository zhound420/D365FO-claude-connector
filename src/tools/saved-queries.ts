/**
 * Saved Queries tools - store and execute reusable query templates
 */

import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { D365Client, D365Error } from "../d365-client.js";
import type { ODataResponse } from "../types.js";

/**
 * Storage path for saved queries
 */
const QUERIES_FILE = path.join(os.homedir(), ".d365-queries.json");

/**
 * Saved query definition
 */
export interface SavedQuery {
  name: string;
  description?: string;
  entity: string;
  select?: string[];
  filter?: string;
  orderBy?: string;
  top?: number;
  expand?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Storage format
 */
interface QueriesStorage {
  version: number;
  queries: Record<string, SavedQuery>;
}

/**
 * Load saved queries from disk
 */
export function loadSavedQueries(): Record<string, SavedQuery> {
  try {
    if (fs.existsSync(QUERIES_FILE)) {
      const content = fs.readFileSync(QUERIES_FILE, "utf-8");
      const storage: QueriesStorage = JSON.parse(content);
      return storage.queries || {};
    }
  } catch (error) {
    // If file is corrupted, start fresh
    console.error("Error loading saved queries:", error);
  }
  return {};
}

/**
 * Save queries to disk
 */
function saveQueries(queries: Record<string, SavedQuery>): void {
  const storage: QueriesStorage = {
    version: 1,
    queries,
  };
  fs.writeFileSync(QUERIES_FILE, JSON.stringify(storage, null, 2), "utf-8");
}

/**
 * Substitute parameters in a string
 * Parameters use the format {{paramName}}
 */
function substituteParameters(
  template: string,
  params: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(pattern, value);
  }
  return result;
}

/**
 * Extract parameter names from a query template
 */
function extractParameterNames(query: SavedQuery): string[] {
  const params = new Set<string>();
  const pattern = /\{\{(\w+)\}\}/g;

  // Check all string fields that might contain parameters
  const checkString = (str: string | undefined) => {
    if (!str) return;
    let match;
    while ((match = pattern.exec(str)) !== null) {
      params.add(match[1]);
    }
  };

  checkString(query.filter);
  checkString(query.orderBy);
  checkString(query.expand);
  query.select?.forEach(checkString);

  return Array.from(params);
}

/**
 * Build OData query path from saved query
 */
function buildQueryPath(query: SavedQuery, params?: Record<string, string>): string {
  const queryParams: string[] = [];

  if (query.select && query.select.length > 0) {
    let selectStr = query.select.join(",");
    if (params) selectStr = substituteParameters(selectStr, params);
    queryParams.push(`$select=${encodeURIComponent(selectStr)}`);
  }

  if (query.filter) {
    let filterStr = query.filter;
    if (params) filterStr = substituteParameters(filterStr, params);
    queryParams.push(`$filter=${encodeURIComponent(filterStr)}`);
  }

  if (query.orderBy) {
    let orderByStr = query.orderBy;
    if (params) orderByStr = substituteParameters(orderByStr, params);
    queryParams.push(`$orderby=${encodeURIComponent(orderByStr)}`);
  }

  if (query.top !== undefined) {
    queryParams.push(`$top=${query.top}`);
  }

  if (query.expand) {
    let expandStr = query.expand;
    if (params) expandStr = substituteParameters(expandStr, params);
    queryParams.push(`$expand=${encodeURIComponent(expandStr)}`);
  }

  // Always include count
  queryParams.push("$count=true");

  let path = `/${query.entity}`;
  if (queryParams.length > 0) {
    path += `?${queryParams.join("&")}`;
  }

  return path;
}

/**
 * Register the save_query tool
 */
export function registerSaveQueryTool(server: McpServer): void {
  server.tool(
    "save_query",
    `Save a reusable query template for later execution.

Query templates can include parameters using {{paramName}} syntax that will be substituted at execution time.

Examples:
- Basic query: name="active_customers", entity="CustomersV3", filter="IsActive eq true"
- With parameters: name="customer_orders", entity="SalesOrderHeaders", filter="CustomerAccount eq '{{customerId}}'"
- Complex query: name="recent_sales", entity="SalesOrderLines", select=["ItemNumber", "LineAmount"], filter="CreatedDateTime ge {{startDate}}", orderBy="CreatedDateTime desc", top=100`,
    {
      name: z.string().describe("Unique name for the query (e.g., 'active_customers')"),
      description: z.string().optional().describe("Optional description of what the query does"),
      entity: z.string().describe("Entity to query (e.g., 'CustomersV3')"),
      select: z.array(z.string()).optional().describe("Fields to select"),
      filter: z.string().optional().describe("OData $filter expression. Use {{paramName}} for parameters."),
      orderBy: z.string().optional().describe("OData $orderby expression"),
      top: z.number().optional().describe("Maximum records to return"),
      expand: z.string().optional().describe("OData $expand expression for related entities"),
    },
    async ({ name, description, entity, select, filter, orderBy, top, expand }) => {
      try {
        const queries = loadSavedQueries();
        const isUpdate = queries[name] !== undefined;
        const now = new Date().toISOString();

        const query: SavedQuery = {
          name,
          description,
          entity,
          select,
          filter,
          orderBy,
          top,
          expand,
          createdAt: isUpdate ? queries[name].createdAt : now,
          updatedAt: now,
        };

        queries[name] = query;
        saveQueries(queries);

        const params = extractParameterNames(query);
        const paramInfo = params.length > 0
          ? `\nParameters: ${params.join(", ")}`
          : "";

        return {
          content: [
            {
              type: "text",
              text: `Query '${name}' ${isUpdate ? "updated" : "saved"} successfully.${paramInfo}\n\nUse execute_saved_query to run this query.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error saving query: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Register the execute_saved_query tool
 */
export function registerExecuteSavedQueryTool(server: McpServer, client: D365Client): void {
  server.tool(
    "execute_saved_query",
    `Execute a previously saved query template.

Provide parameter values for any {{paramName}} placeholders in the saved query.
Use the d365://queries resource to list available saved queries.

Examples:
- Simple: name="active_customers"
- With parameters: name="customer_orders", params={"customerId": "US-001"}
- Multiple params: name="date_range_sales", params={"startDate": "2024-01-01", "endDate": "2024-12-31"}`,
    {
      name: z.string().describe("Name of the saved query to execute"),
      params: z.record(z.string()).optional().describe(
        "Parameter values to substitute in the query template"
      ),
      fetchAll: z.boolean().optional().default(false).describe(
        "Automatically fetch all pages of results (default: false)"
      ),
      maxRecords: z.number().optional().default(50000).describe(
        "Maximum records to return (default: 50000). Limits results in both single-request and fetchAll modes."
      ),
    },
    async ({ name, params, fetchAll, maxRecords }) => {
      try {
        const queries = loadSavedQueries();
        const query = queries[name];

        if (!query) {
          const available = Object.keys(queries);
          return {
            content: [
              {
                type: "text",
                text: `Query '${name}' not found.\n\nAvailable queries: ${available.length > 0 ? available.join(", ") : "(none)"}`,
              },
            ],
            isError: true,
          };
        }

        // Check for missing parameters
        const requiredParams = extractParameterNames(query);
        const providedParams = params ? Object.keys(params) : [];
        const missingParams = requiredParams.filter((p) => !providedParams.includes(p));

        if (missingParams.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: `Missing required parameters: ${missingParams.join(", ")}\n\nProvide these in the params object.`,
              },
            ],
            isError: true,
          };
        }

        // Build and execute query
        const path = buildQueryPath(query, params);

        if (fetchAll) {
          // Paginated fetch
          const allRecords: unknown[] = [];
          let pagesFetched = 0;
          let totalCount: number | undefined;
          let truncated = false;
          let nextLink: string | undefined = path;

          while (nextLink) {
            const response: ODataResponse = await client.request(nextLink);
            pagesFetched++;

            if (pagesFetched === 1 && response["@odata.count"] !== undefined) {
              totalCount = response["@odata.count"];
            }

            if (response.value && Array.isArray(response.value)) {
              allRecords.push(...response.value);
            }

            if (allRecords.length >= maxRecords) {
              truncated = true;
              break;
            }

            nextLink = response["@odata.nextLink"];
          }

          const lines: string[] = [];
          lines.push(`Executed saved query: ${name}`);
          if (query.description) {
            lines.push(`Description: ${query.description}`);
          }

          let summary = `Fetched ${allRecords.slice(0, maxRecords).length.toLocaleString()} record(s)`;
          if (totalCount !== undefined) {
            summary += ` of ${totalCount.toLocaleString()} total`;
          }
          summary += ` (${pagesFetched} page(s))`;
          if (truncated) {
            summary += ` [truncated at maxRecords=${maxRecords}]`;
          }
          lines.push(summary);
          lines.push("");
          lines.push(JSON.stringify(allRecords.slice(0, maxRecords), null, 2));

          return {
            content: [
              {
                type: "text",
                text: lines.join("\n"),
              },
            ],
          };
        }

        // Single request
        const response: ODataResponse = await client.request(path);

        const lines: string[] = [];
        lines.push(`Executed saved query: ${name}`);
        if (query.description) {
          lines.push(`Description: ${query.description}`);
        }

        if (response.value && Array.isArray(response.value)) {
          // Apply maxRecords limit
          const records = response.value.slice(0, maxRecords);
          const totalReturned = response.value.length;
          const count = response["@odata.count"];
          const nextLink = response["@odata.nextLink"];

          let summary = `Found ${records.length} record(s)`;
          if (totalReturned > maxRecords) {
            summary += ` (limited from ${totalReturned} returned)`;
          }
          if (count !== undefined) {
            summary += ` (total: ${count.toLocaleString()})`;
          }
          if (nextLink) {
            summary += " [more available - use fetchAll=true]";
          }
          lines.push(summary);
          lines.push("");
          lines.push(JSON.stringify(records, null, 2));
        } else {
          lines.push("");
          lines.push(JSON.stringify(response, null, 2));
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
        } else {
          message = `Error executing query: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Register the delete_saved_query tool
 */
export function registerDeleteSavedQueryTool(server: McpServer): void {
  server.tool(
    "delete_saved_query",
    `Delete a saved query.

Examples:
- Delete query: name="old_query"`,
    {
      name: z.string().describe("Name of the saved query to delete"),
    },
    async ({ name }) => {
      try {
        const queries = loadSavedQueries();

        if (!queries[name]) {
          return {
            content: [
              {
                type: "text",
                text: `Query '${name}' not found.`,
              },
            ],
            isError: true,
          };
        }

        delete queries[name];
        saveQueries(queries);

        return {
          content: [
            {
              type: "text",
              text: `Query '${name}' deleted successfully.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting query: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Register all saved query tools
 */
export function registerSavedQueryTools(server: McpServer, client: D365Client): void {
  registerSaveQueryTool(server);
  registerExecuteSavedQueryTool(server, client);
  registerDeleteSavedQueryTool(server);
}
