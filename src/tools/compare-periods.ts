/**
 * Compare Periods tool - built-in YoY, QoQ, MoM comparisons
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import type { EnvironmentManager } from "../environment-manager.js";
import { D365Client, D365Error } from "../d365-client.js";
import type { ODataResponse } from "../types.js";
import {
  type ComparisonType,
  getComparisonPeriods,
  buildDateFilter,
  parseDate,
  formatDate,
  type DatePeriod,
} from "../utils/date-utils.js";
import { formatTiming } from "../progress.js";
import { environmentSchema } from "./common.js";

/**
 * Aggregation function types
 */
type AggregationFunction = "SUM" | "AVG" | "COUNT" | "MIN" | "MAX";

/**
 * Aggregation specification
 */
interface AggregationSpec {
  function: AggregationFunction;
  field: string;
  alias?: string;
}

/**
 * Comparison result for a single group
 */
interface ComparisonResult {
  groupKey?: Record<string, unknown>;
  currentPeriod: Record<string, number>;
  previousPeriod: Record<string, number>;
  change: Record<string, number>;
  changePercent: Record<string, number | null>;
}

/**
 * Streaming aggregation state
 */
interface StreamingAggState {
  sum: number;
  count: number;
  min: number;
  max: number;
}

/**
 * Create initial streaming state
 */
function createStreamingState(): StreamingAggState {
  return {
    sum: 0,
    count: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
  };
}

/**
 * Update streaming state with a value
 */
function updateStreamingState(state: StreamingAggState, value: unknown): void {
  if (typeof value !== "number") return;
  state.count++;
  state.sum += value;
  if (value < state.min) state.min = value;
  if (value > state.max) state.max = value;
}

/**
 * Finalize streaming state to get result
 */
function finalizeStreamingValue(state: StreamingAggState, func: AggregationFunction): number {
  switch (func) {
    case "COUNT":
      return state.count;
    case "SUM":
      return state.sum;
    case "AVG":
      return state.count > 0 ? state.sum / state.count : 0;
    case "MIN":
      return state.count > 0 ? state.min : 0;
    case "MAX":
      return state.count > 0 ? state.max : 0;
    default:
      return 0;
  }
}

/**
 * Fetch and aggregate records for a period
 */
async function aggregateForPeriod(
  client: D365Client,
  entity: string,
  dateField: string,
  period: DatePeriod,
  aggregations: AggregationSpec[],
  additionalFilter?: string,
  groupBy?: string[]
): Promise<Map<string, Record<string, number>>> {
  // Build filter
  const dateFilter = buildDateFilter(dateField, period.start, period.end);
  const filter = additionalFilter
    ? `(${dateFilter}) and (${additionalFilter})`
    : dateFilter;

  // Determine fields needed
  const fieldsNeeded = new Set<string>([dateField]);
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

  // Build query
  const selectFields = Array.from(fieldsNeeded).join(",");
  let path = `/${entity}?$select=${encodeURIComponent(selectFields)}&$filter=${encodeURIComponent(filter)}`;

  // State: Map<groupKey, Map<alias, StreamingAggState>>
  const stateMap = new Map<string, Map<string, StreamingAggState>>();
  const groupKeyMap = new Map<string, Record<string, unknown>>();

  // Initialize for ungrouped case
  if (!groupBy || groupBy.length === 0) {
    const aggStates = new Map<string, StreamingAggState>();
    for (const agg of aggregations) {
      const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;
      aggStates.set(alias, createStreamingState());
    }
    stateMap.set("__all__", aggStates);
  }

  // Fetch and aggregate
  let nextLink: string | undefined = path;
  while (nextLink) {
    const response: ODataResponse<Record<string, unknown>> = await client.request(nextLink);

    if (response.value && Array.isArray(response.value)) {
      for (const record of response.value) {
        // Determine group key
        let groupKeyStr = "__all__";
        if (groupBy && groupBy.length > 0) {
          const keyParts = groupBy.map((field) => String(record[field] ?? "null"));
          groupKeyStr = keyParts.join("|");

          // Initialize group if new
          if (!stateMap.has(groupKeyStr)) {
            const aggStates = new Map<string, StreamingAggState>();
            for (const agg of aggregations) {
              const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;
              aggStates.set(alias, createStreamingState());
            }
            stateMap.set(groupKeyStr, aggStates);

            // Store group key values
            const groupKey: Record<string, unknown> = {};
            for (const field of groupBy) {
              groupKey[field] = record[field];
            }
            groupKeyMap.set(groupKeyStr, groupKey);
          }
        }

        // Update aggregations
        const aggStates = stateMap.get(groupKeyStr)!;
        for (const agg of aggregations) {
          const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;
          const state = aggStates.get(alias)!;

          if (agg.field === "*") {
            state.count++;
          } else {
            updateStreamingState(state, record[agg.field]);
          }
        }
      }
    }

    nextLink = response["@odata.nextLink"];
  }

  // Finalize results
  const results = new Map<string, Record<string, number>>();
  for (const [groupKeyStr, aggStates] of stateMap) {
    const values: Record<string, number> = {};
    for (const agg of aggregations) {
      const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;
      const state = aggStates.get(alias)!;
      values[alias] = finalizeStreamingValue(state, agg.function);
    }
    results.set(groupKeyStr, values);
  }

  return results;
}

/**
 * Format comparison results
 */
function formatComparisonResults(
  results: ComparisonResult[],
  currentLabel: string,
  previousLabel: string,
  groupBy?: string[]
): string {
  const lines: string[] = [];

  lines.push(`Period Comparison: ${previousLabel} vs ${currentLabel}`);
  lines.push("");

  if (groupBy && groupBy.length > 0) {
    // Grouped results
    for (const result of results) {
      const groupDesc = groupBy
        .map((field) => `${field}=${result.groupKey?.[field] ?? "null"}`)
        .join(", ");
      lines.push(`[${groupDesc}]`);

      for (const alias of Object.keys(result.currentPeriod)) {
        const current = result.currentPeriod[alias];
        const previous = result.previousPeriod[alias];
        const change = result.change[alias];
        const changePercent = result.changePercent[alias];

        const formatValue = (v: number) =>
          Number.isInteger(v)
            ? v.toLocaleString()
            : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const changeStr = change >= 0 ? `+${formatValue(change)}` : formatValue(change);
        const percentStr = changePercent !== null
          ? ` (${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(1)}%)`
          : " (N/A)";

        lines.push(`  ${alias}:`);
        lines.push(`    ${previousLabel}: ${formatValue(previous)}`);
        lines.push(`    ${currentLabel}: ${formatValue(current)}`);
        lines.push(`    Change: ${changeStr}${percentStr}`);
      }
      lines.push("");
    }
  } else {
    // Single result
    const result = results[0];
    if (result) {
      for (const alias of Object.keys(result.currentPeriod)) {
        const current = result.currentPeriod[alias];
        const previous = result.previousPeriod[alias];
        const change = result.change[alias];
        const changePercent = result.changePercent[alias];

        const formatValue = (v: number) =>
          Number.isInteger(v)
            ? v.toLocaleString()
            : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const changeStr = change >= 0 ? `+${formatValue(change)}` : formatValue(change);
        const percentStr = changePercent !== null
          ? ` (${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(1)}%)`
          : " (N/A)";

        lines.push(`${alias}:`);
        lines.push(`  ${previousLabel}: ${formatValue(previous)}`);
        lines.push(`  ${currentLabel}: ${formatValue(current)}`);
        lines.push(`  Change: ${changeStr}${percentStr}`);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

/**
 * Register the compare_periods tool
 */
export function registerComparePeriodsTool(server: McpServer, envManager: EnvironmentManager): void {
  server.tool(
    "compare_periods",
    `Compare aggregations between two time periods (YoY, QoQ, MoM, or custom ranges).

Automatically calculates change amounts and percentages for easy trend analysis.
Useful for financial reporting, sales analysis, and performance tracking.

Examples:
- Year-over-Year: entity="SalesOrderLines", dateField="CreatedDateTime", comparisonType="YoY", aggregations=[{function: "SUM", field: "LineAmount"}]
- Month-over-Month: comparisonType="MoM", aggregations=[{function: "COUNT", field: "*"}]
- Quarter-over-Quarter by category: comparisonType="QoQ", groupBy=["ItemGroup"]
- Custom periods: comparisonType="custom", period1={start: "2024-01-01", end: "2024-03-31"}, period2={start: "2023-01-01", end: "2023-03-31"}`,
    {
      entity: z.string().describe("Entity to analyze (e.g., 'SalesOrderLines')"),
      dateField: z.string().describe("Date/datetime field for period filtering (e.g., 'CreatedDateTime')"),
      aggregations: z.array(
        z.object({
          function: z.enum(["SUM", "AVG", "COUNT", "MIN", "MAX"]).describe("Aggregation function"),
          field: z.string().describe("Field to aggregate (use '*' for COUNT)"),
          alias: z.string().optional().describe("Optional result alias"),
        })
      ).min(1).describe("Array of aggregation specifications"),
      comparisonType: z.enum(["YoY", "QoQ", "MoM", "custom"]).describe(
        "Comparison type: YoY (year-over-year), QoQ (quarter-over-quarter), MoM (month-over-month), or custom"
      ),
      referenceDate: z.string().optional().describe(
        "Reference date for YoY/QoQ/MoM calculations (defaults to today). Format: YYYY-MM-DD"
      ),
      period1: z.object({
        start: z.string(),
        end: z.string(),
      }).optional().describe(
        "Current period for custom comparison. Format: {start: 'YYYY-MM-DD', end: 'YYYY-MM-DD'}"
      ),
      period2: z.object({
        start: z.string(),
        end: z.string(),
      }).optional().describe(
        "Previous period for custom comparison. Format: {start: 'YYYY-MM-DD', end: 'YYYY-MM-DD'}"
      ),
      filter: z.string().optional().describe(
        "Additional OData $filter to apply to both periods"
      ),
      groupBy: z.array(z.string()).optional().describe(
        "Fields to group by for per-group comparisons"
      ),
      environment: environmentSchema,
    },
    async ({ entity, dateField, aggregations, comparisonType, referenceDate, period1, period2, filter, groupBy, environment }, _extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const client = envManager.getClient(environment);

      try {
        const startTime = Date.now();
        let currentPeriod: DatePeriod;
        let previousPeriod: DatePeriod;

        if (comparisonType === "custom") {
          // Custom periods
          if (!period1 || !period2) {
            return {
              content: [
                {
                  type: "text",
                  text: "Custom comparison requires both period1 and period2 parameters.",
                },
              ],
              isError: true,
            };
          }

          currentPeriod = {
            start: parseDate(period1.start),
            end: parseDate(period1.end),
            label: `${formatDate(parseDate(period1.start))} to ${formatDate(parseDate(period1.end))}`,
          };

          previousPeriod = {
            start: parseDate(period2.start),
            end: parseDate(period2.end),
            label: `${formatDate(parseDate(period2.start))} to ${formatDate(parseDate(period2.end))}`,
          };
        } else {
          // Built-in comparison types
          const refDate = referenceDate ? parseDate(referenceDate) : new Date();
          const periods = getComparisonPeriods(comparisonType as ComparisonType, refDate);
          currentPeriod = periods.current;
          previousPeriod = periods.previous;
        }

        // Aggregate for both periods
        const [currentResults, previousResults] = await Promise.all([
          aggregateForPeriod(client, entity, dateField, currentPeriod, aggregations, filter, groupBy),
          aggregateForPeriod(client, entity, dateField, previousPeriod, aggregations, filter, groupBy),
        ]);

        // Combine results and calculate changes
        const allGroupKeys = new Set([...currentResults.keys(), ...previousResults.keys()]);
        const comparisonResults: ComparisonResult[] = [];

        for (const groupKeyStr of allGroupKeys) {
          const currentValues = currentResults.get(groupKeyStr) || {};
          const previousValues = previousResults.get(groupKeyStr) || {};

          const change: Record<string, number> = {};
          const changePercent: Record<string, number | null> = {};

          for (const agg of aggregations) {
            const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;
            const currentVal = currentValues[alias] || 0;
            const previousVal = previousValues[alias] || 0;

            change[alias] = currentVal - previousVal;
            changePercent[alias] = previousVal !== 0
              ? ((currentVal - previousVal) / previousVal) * 100
              : null;
          }

          // Build group key object
          let groupKey: Record<string, unknown> | undefined;
          if (groupBy && groupBy.length > 0 && groupKeyStr !== "__all__") {
            groupKey = {};
            const keyParts = groupKeyStr.split("|");
            groupBy.forEach((field, index) => {
              groupKey![field] = keyParts[index] === "null" ? null : keyParts[index];
            });
          }

          comparisonResults.push({
            groupKey,
            currentPeriod: { ...currentValues },
            previousPeriod: { ...previousValues },
            change,
            changePercent,
          });
        }

        // Sort by first aggregation value descending
        const firstAlias = aggregations[0].alias ||
          `${aggregations[0].function.toLowerCase()}_${aggregations[0].field === "*" ? "all" : aggregations[0].field}`;
        comparisonResults.sort((a, b) => (b.currentPeriod[firstAlias] || 0) - (a.currentPeriod[firstAlias] || 0));

        const output = formatComparisonResults(
          comparisonResults,
          currentPeriod.label,
          previousPeriod.label,
          groupBy
        );

        const timing = formatTiming(Date.now() - startTime);

        return {
          content: [
            {
              type: "text",
              text: timing ? `${output}\n${timing.trim()}` : output,
            },
          ],
        };
      } catch (error) {
        let message: string;
        if (error instanceof D365Error) {
          message = error.message;
        } else {
          message = `Comparison error: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
