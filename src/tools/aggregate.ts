/**
 * Aggregation tool - performs SUM, AVG, COUNT, MIN, MAX on D365 data
 * Uses fast /$count for simple COUNT operations, client-side aggregation otherwise
 * (D365 F&O has limited $apply support, so we skip it to avoid timeouts)
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { D365Client, D365Error } from "../d365-client.js";
import type { ODataResponse } from "../types.js";

/**
 * Supported aggregation functions
 */
type AggregationFunction = "SUM" | "AVG" | "COUNT" | "MIN" | "MAX" | "COUNTDISTINCT";

/**
 * Single aggregation specification
 */
interface AggregationSpec {
  function: AggregationFunction;
  field: string;
  alias?: string;
}

/**
 * Aggregation result for a single group
 */
interface AggregationResult {
  groupKey?: Record<string, unknown>;
  values: Record<string, number>;
}

/**
 * Default max records for client-side fallback
 */
const DEFAULT_MAX_RECORDS = 5000;

/**
 * Build OData $apply string for server-side aggregation
 */
function buildApplyString(
  aggregations: AggregationSpec[],
  filter?: string,
  groupBy?: string[]
): string {
  const parts: string[] = [];

  // Add filter if present
  if (filter) {
    parts.push(`filter(${filter})`);
  }

  // Build aggregate expressions
  const aggregateExprs = aggregations.map((agg) => {
    const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;

    if (agg.function === "COUNT" && agg.field === "*") {
      return `$count as ${alias}`;
    }

    if (agg.function === "COUNTDISTINCT") {
      return `${agg.field} with countdistinct as ${alias}`;
    }

    return `${agg.field} with ${agg.function.toLowerCase()} as ${alias}`;
  });

  // Build groupby or aggregate clause
  if (groupBy && groupBy.length > 0) {
    parts.push(`groupby((${groupBy.join(",")}),aggregate(${aggregateExprs.join(",")}))`);
  } else {
    parts.push(`aggregate(${aggregateExprs.join(",")})`);
  }

  return parts.join("/");
}

/**
 * Fast path for simple COUNT operations using /$count endpoint
 * This is much faster than $apply and works reliably on D365 F&O
 */
async function tryFastCount(
  client: D365Client,
  entity: string,
  filter?: string
): Promise<number | null> {
  try {
    let path = `/${entity}/$count`;
    if (filter) {
      path += `?$filter=${encodeURIComponent(filter)}`;
    }
    return await client.request<number>(path);
  } catch {
    return null;
  }
}

/**
 * Try server-side aggregation using $apply
 */
async function tryServerSideAggregation(
  client: D365Client,
  entity: string,
  aggregations: AggregationSpec[],
  filter?: string,
  groupBy?: string[]
): Promise<{ success: boolean; results?: AggregationResult[]; error?: string }> {
  try {
    const applyString = buildApplyString(aggregations, filter, groupBy);
    const path = `/${entity}?$apply=${encodeURIComponent(applyString)}`;

    const response = await client.request<ODataResponse>(path);

    if (!response.value || !Array.isArray(response.value)) {
      return { success: false, error: "Unexpected response format" };
    }

    const results: AggregationResult[] = response.value.map((rawRow) => {
      const row = rawRow as Record<string, unknown>;
      const values: Record<string, number> = {};
      const groupKey: Record<string, unknown> = {};

      for (const agg of aggregations) {
        const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;
        const value = row[alias];
        if (typeof value === "number") {
          values[alias] = value;
        } else if (value !== undefined) {
          values[alias] = Number(value) || 0;
        }
      }

      if (groupBy) {
        for (const field of groupBy) {
          groupKey[field] = row[field];
        }
      }

      return groupBy && groupBy.length > 0
        ? { groupKey, values }
        : { values };
    });

    return { success: true, results };
  } catch (error) {
    if (error instanceof D365Error) {
      // Check if it's a "not supported" error
      if (error.statusCode === 400 || error.statusCode === 501) {
        return { success: false, error: error.message };
      }
      throw error;
    }
    return { success: false, error: String(error) };
  }
}

/**
 * Fetch all records with pagination for client-side aggregation
 */
async function fetchAllRecords(
  client: D365Client,
  entity: string,
  fields: string[],
  filter?: string,
  maxRecords: number = DEFAULT_MAX_RECORDS
): Promise<Record<string, unknown>[]> {
  const allRecords: Record<string, unknown>[] = [];

  // Build initial query
  const selectFields = fields.filter((f) => f !== "*").join(",");
  let path = `/${entity}?$top=5000`;
  if (selectFields) {
    path += `&$select=${encodeURIComponent(selectFields)}`;
  }
  if (filter) {
    path += `&$filter=${encodeURIComponent(filter)}`;
  }

  let nextLink: string | undefined = path;

  while (nextLink && allRecords.length < maxRecords) {
    const response: ODataResponse<Record<string, unknown>> = await client.request(nextLink);

    if (response.value && Array.isArray(response.value)) {
      allRecords.push(...response.value);
    }

    nextLink = response["@odata.nextLink"];

    // Respect maxRecords limit
    if (allRecords.length >= maxRecords) {
      break;
    }
  }

  return allRecords.slice(0, maxRecords);
}

/**
 * Calculate a single aggregation on a set of values
 */
function calculateAggregation(
  func: AggregationFunction,
  values: number[]
): number {
  if (values.length === 0) {
    return 0;
  }

  switch (func) {
    case "COUNT":
      return values.length;
    case "SUM":
      return values.reduce((sum, v) => sum + v, 0);
    case "AVG":
      return values.reduce((sum, v) => sum + v, 0) / values.length;
    case "MIN":
      return Math.min(...values);
    case "MAX":
      return Math.max(...values);
    case "COUNTDISTINCT":
      return new Set(values).size;
    default:
      return 0;
  }
}

/**
 * Perform client-side aggregation with optional grouping
 */
function performClientSideAggregation(
  records: Record<string, unknown>[],
  aggregations: AggregationSpec[],
  groupBy?: string[]
): AggregationResult[] {
  // Group records if groupBy is specified
  if (groupBy && groupBy.length > 0) {
    const groups = new Map<string, Record<string, unknown>[]>();

    for (const record of records) {
      const keyParts = groupBy.map((field) => String(record[field] ?? "null"));
      const key = keyParts.join("|");

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(record);
    }

    const results: AggregationResult[] = [];

    for (const [key, groupRecords] of groups) {
      const groupKey: Record<string, unknown> = {};
      const keyParts = key.split("|");
      groupBy.forEach((field, index) => {
        groupKey[field] = groupRecords[0]?.[field] ?? keyParts[index];
      });

      const values: Record<string, number> = {};

      for (const agg of aggregations) {
        const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;

        if (agg.function === "COUNT" && agg.field === "*") {
          values[alias] = groupRecords.length;
        } else {
          const fieldValues = groupRecords
            .map((r) => r[agg.field])
            .filter((v): v is number => typeof v === "number");
          values[alias] = calculateAggregation(agg.function, fieldValues);
        }
      }

      results.push({ groupKey, values });
    }

    return results;
  }

  // No grouping - aggregate all records
  const values: Record<string, number> = {};

  for (const agg of aggregations) {
    const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;

    if (agg.function === "COUNT" && agg.field === "*") {
      values[alias] = records.length;
    } else {
      const fieldValues = records
        .map((r) => r[agg.field])
        .filter((v): v is number => typeof v === "number");
      values[alias] = calculateAggregation(agg.function, fieldValues);
    }
  }

  return [{ values }];
}

/**
 * Format aggregation results for output
 */
function formatAggregationResult(
  results: AggregationResult[],
  groupBy?: string[],
  method: "server" | "client" = "server",
  recordCount?: number
): string {
  const lines: string[] = [];

  // Header
  if (groupBy && groupBy.length > 0) {
    lines.push(`Aggregation Results (${results.length} groups)`);
  } else {
    lines.push("Aggregation Results");
  }
  lines.push(`Method: ${method === "server" ? "Server-side ($apply)" : "Client-side"}`);

  if (method === "client" && recordCount !== undefined) {
    lines.push(`Records processed: ${recordCount.toLocaleString()}`);
  }

  lines.push("");

  // Results
  if (groupBy && groupBy.length > 0) {
    // Grouped results
    for (const result of results) {
      const groupDesc = groupBy
        .map((field) => `${field}=${result.groupKey?.[field] ?? "null"}`)
        .join(", ");
      lines.push(`[${groupDesc}]`);

      for (const [alias, value] of Object.entries(result.values)) {
        const formattedValue = Number.isInteger(value)
          ? value.toLocaleString()
          : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
        lines.push(`  ${alias}: ${formattedValue}`);
      }
      lines.push("");
    }
  } else {
    // Single result
    const result = results[0];
    if (result) {
      for (const [alias, value] of Object.entries(result.values)) {
        const formattedValue = Number.isInteger(value)
          ? value.toLocaleString()
          : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
        lines.push(`${alias}: ${formattedValue}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Register the aggregate tool
 */
export function registerAggregateTool(server: McpServer, client: D365Client): void {
  server.tool(
    "aggregate",
    `Perform aggregations (SUM, AVG, COUNT, MIN, MAX, COUNTDISTINCT) on D365 entity data.

Uses fast /$count endpoint for simple COUNT operations, client-side aggregation for other operations.

Examples:
- Count all customers: entity="CustomersV3", aggregations=[{function: "COUNT", field: "*"}]
- Sum line amounts: entity="SalesOrderLines", aggregations=[{function: "SUM", field: "LineAmount"}]
- Multiple aggregations: aggregations=[{function: "SUM", field: "LineAmount"}, {function: "AVG", field: "LineAmount"}]
- With filter: filter="SalesOrderNumber eq 'SO-001'"
- Group by: groupBy=["ItemNumber"] to get aggregations per item`,
    {
      entity: z.string().describe("Entity name to aggregate (e.g., 'SalesOrderLines')"),
      aggregations: z.array(
        z.object({
          function: z.enum(["SUM", "AVG", "COUNT", "MIN", "MAX", "COUNTDISTINCT"]).describe("Aggregation function"),
          field: z.string().describe("Field to aggregate (use '*' for COUNT)"),
          alias: z.string().optional().describe("Optional result alias"),
        })
      ).min(1).describe("Array of aggregation specifications"),
      filter: z.string().optional().describe("OData $filter expression"),
      groupBy: z.array(z.string()).optional().describe("Fields to group by"),
      maxRecords: z.number().optional().default(DEFAULT_MAX_RECORDS).describe(
        `Maximum records for client-side fallback (default: ${DEFAULT_MAX_RECORDS})`
      ),
    },
    async ({ entity, aggregations, filter, groupBy, maxRecords }) => {
      try {
        // Check if this is a simple COUNT(*) with no groupBy
        const isSimpleCount =
          aggregations.length === 1 &&
          aggregations[0].function === "COUNT" &&
          aggregations[0].field === "*" &&
          (!groupBy || groupBy.length === 0);

        // Fast path: use /$count endpoint for simple COUNT operations
        if (isSimpleCount) {
          const count = await tryFastCount(client, entity, filter);
          if (count !== null) {
            const alias = aggregations[0].alias || "count_all";
            return {
              content: [
                {
                  type: "text",
                  text: `Aggregation Results\nMethod: Server-side (/$count)\n\n${alias}: ${count.toLocaleString()}`,
                },
              ],
            };
          }
        }

        // Skip $apply - D365 F&O has limited support and it causes timeouts
        // Go directly to client-side aggregation

        // Extract fields needed for aggregation
        const fieldsNeeded = new Set<string>();
        for (const agg of aggregations) {
          if (agg.field !== "*") {
            fieldsNeeded.add(agg.field);
          }
        }
        if (groupBy) {
          for (const field of groupBy) {
            fieldsNeeded.add(field);
          }
        }

        const records = await fetchAllRecords(
          client,
          entity,
          Array.from(fieldsNeeded),
          filter,
          maxRecords
        );

        const results = performClientSideAggregation(records, aggregations, groupBy);

        const output = formatAggregationResult(results, groupBy, "client", records.length);

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
        } else {
          message = `Aggregation error: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
