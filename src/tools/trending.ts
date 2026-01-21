/**
 * Trending tool - time series analysis with growth rates and moving averages
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { D365Client, D365Error } from "../d365-client.js";
import type { ODataResponse } from "../types.js";
import {
  type Granularity,
  getBucketKey,
  generatePeriodStarts,
  buildDateFilter,
  parseDate,
  formatDate,
  addDays,
  addWeeks,
  addMonths,
  addQuarters,
  addYears,
  startOfDay,
  endOfDay,
} from "../utils/date-utils.js";
import { formatTiming } from "../progress.js";

/**
 * Aggregation function types
 */
type AggregationFunction = "SUM" | "AVG" | "COUNT" | "MIN" | "MAX";

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
 * Period data point
 */
interface TrendDataPoint {
  period: string;
  value: number;
  growthRate: number | null;
  movingAverage: number | null;
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
 * Get the end date for a period based on granularity
 */
function getPeriodEnd(startDate: Date, granularity: Granularity): Date {
  switch (granularity) {
    case "day":
      return endOfDay(startDate);
    case "week":
      return endOfDay(addDays(startDate, 6));
    case "month":
      return endOfDay(addDays(addMonths(startDate, 1), -1));
    case "quarter":
      return endOfDay(addDays(addQuarters(startDate, 1), -1));
    case "year":
      return endOfDay(addDays(addYears(startDate, 1), -1));
    default:
      return endOfDay(startDate);
  }
}

/**
 * Calculate moving average for a series
 */
function calculateMovingAverages(
  values: number[],
  windowSize: number
): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < values.length; i++) {
    if (i < windowSize - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - windowSize + 1; j <= i; j++) {
        sum += values[j];
      }
      result.push(sum / windowSize);
    }
  }

  return result;
}

/**
 * Calculate growth rates for a series
 */
function calculateGrowthRates(values: number[]): (number | null)[] {
  const result: (number | null)[] = [null]; // First period has no growth rate

  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1];
    const current = values[i];

    if (previous === 0) {
      result.push(null);
    } else {
      result.push(((current - previous) / previous) * 100);
    }
  }

  return result;
}

/**
 * Format trending results
 */
function formatTrendingResults(
  dataPoints: TrendDataPoint[],
  entity: string,
  valueField: string,
  aggregation: AggregationFunction,
  granularity: Granularity,
  hasMovingAverage: boolean,
  movingAverageWindow?: number
): string {
  const lines: string[] = [];

  lines.push(`Trending Analysis: ${entity}`);
  lines.push(`Metric: ${aggregation}(${valueField}) by ${granularity}`);
  if (hasMovingAverage && movingAverageWindow) {
    lines.push(`Moving Average: ${movingAverageWindow}-period`);
  }
  lines.push("");

  // Table header
  const headers = ["Period", "Value"];
  if (dataPoints.some((dp) => dp.growthRate !== null)) {
    headers.push("Growth %");
  }
  if (hasMovingAverage) {
    headers.push(`MA(${movingAverageWindow})`);
  }

  lines.push(headers.join("\t"));
  lines.push("-".repeat(headers.join("\t").length));

  // Data rows
  for (const dp of dataPoints) {
    const row: string[] = [dp.period];

    // Format value
    const formattedValue = Number.isInteger(dp.value)
      ? dp.value.toLocaleString()
      : dp.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    row.push(formattedValue);

    // Growth rate
    if (headers.includes("Growth %")) {
      if (dp.growthRate === null) {
        row.push("-");
      } else {
        const sign = dp.growthRate >= 0 ? "+" : "";
        row.push(`${sign}${dp.growthRate.toFixed(1)}%`);
      }
    }

    // Moving average
    if (hasMovingAverage) {
      if (dp.movingAverage === null) {
        row.push("-");
      } else {
        const formattedMA = Number.isInteger(dp.movingAverage)
          ? dp.movingAverage.toLocaleString()
          : dp.movingAverage.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        row.push(formattedMA);
      }
    }

    lines.push(row.join("\t"));
  }

  lines.push("");

  // Summary statistics
  const values = dataPoints.map((dp) => dp.value);
  const totalSum = values.reduce((sum, v) => sum + v, 0);
  const avgValue = totalSum / values.length;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  lines.push("Summary:");
  lines.push(`  Total: ${totalSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push(`  Average: ${avgValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push(`  Min: ${minValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push(`  Max: ${maxValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Overall growth
  if (values.length >= 2 && values[0] !== 0) {
    const overallGrowth = ((values[values.length - 1] - values[0]) / values[0]) * 100;
    const sign = overallGrowth >= 0 ? "+" : "";
    lines.push(`  Overall Growth: ${sign}${overallGrowth.toFixed(1)}%`);
  }

  return lines.join("\n");
}

/**
 * Register the trending tool
 */
export function registerTrendingTool(server: McpServer, client: D365Client): void {
  server.tool(
    "trending",
    `Time series analysis with aggregation, growth rates, and moving averages.

Buckets data by time granularity and calculates trends over multiple periods.
Useful for identifying patterns, seasonality, and performance trends.

Examples:
- Monthly revenue trend: entity="SalesOrderLines", dateField="CreatedDateTime", valueField="LineAmount", granularity="month", periods=12
- Weekly order count: entity="SalesOrderHeaders", dateField="OrderDate", valueField="*", aggregation="COUNT", granularity="week"
- Quarterly with moving average: granularity="quarter", movingAverageWindow=4
- Daily with filter: filter="ItemGroup eq 'Electronics'", granularity="day", periods=30`,
    {
      entity: z.string().describe("Entity to analyze (e.g., 'SalesOrderLines')"),
      dateField: z.string().describe("Date/datetime field for bucketing (e.g., 'CreatedDateTime')"),
      valueField: z.string().describe("Numeric field to aggregate (use '*' for COUNT)"),
      aggregation: z.enum(["SUM", "AVG", "COUNT", "MIN", "MAX"]).optional().default("SUM").describe(
        "Aggregation function (default: SUM)"
      ),
      granularity: z.enum(["day", "week", "month", "quarter", "year"]).optional().default("month").describe(
        "Time granularity for bucketing (default: month)"
      ),
      periods: z.number().optional().default(12).describe(
        "Number of periods to analyze (default: 12)"
      ),
      endDate: z.string().optional().describe(
        "End date for analysis (defaults to today). Format: YYYY-MM-DD"
      ),
      filter: z.string().optional().describe(
        "Additional OData $filter to apply"
      ),
      movingAverageWindow: z.number().optional().describe(
        "Window size for moving average calculation (e.g., 3 for 3-period MA)"
      ),
      includeGrowthRate: z.boolean().optional().default(true).describe(
        "Include period-over-period growth rate (default: true)"
      ),
    },
    async ({ entity, dateField, valueField, aggregation, granularity, periods, endDate, filter, movingAverageWindow, includeGrowthRate }, _extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      try {
        const startTime = Date.now();
        const aggFunc = aggregation as AggregationFunction;
        const gran = granularity as Granularity;

        // Calculate period boundaries
        const end = endDate ? parseDate(endDate) : new Date();
        const periodStarts = generatePeriodStarts(end, gran, periods);

        if (periodStarts.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No periods to analyze. Check the periods and endDate parameters.",
              },
            ],
            isError: true,
          };
        }

        // Calculate overall date range for query
        const overallStart = periodStarts[0];
        const overallEnd = getPeriodEnd(periodStarts[periodStarts.length - 1], gran);

        // Build filter
        const dateFilter = buildDateFilter(dateField, overallStart, overallEnd);
        const combinedFilter = filter
          ? `(${dateFilter}) and (${filter})`
          : dateFilter;

        // Determine fields to fetch
        const fieldsNeeded = new Set<string>([dateField]);
        if (valueField !== "*") {
          fieldsNeeded.add(valueField);
        }

        // Build query
        const selectFields = Array.from(fieldsNeeded).join(",");
        let path = `/${entity}?$select=${encodeURIComponent(selectFields)}&$filter=${encodeURIComponent(combinedFilter)}`;

        // Initialize buckets
        const buckets = new Map<string, StreamingAggState>();
        for (const periodStart of periodStarts) {
          const key = getBucketKey(periodStart, gran);
          buckets.set(key, createStreamingState());
        }

        // Fetch and bucket records
        let nextLink: string | undefined = path;
        let recordsProcessed = 0;

        while (nextLink) {
          const response: ODataResponse<Record<string, unknown>> = await client.request(nextLink);

          if (response.value && Array.isArray(response.value)) {
            for (const record of response.value) {
              recordsProcessed++;

              // Parse the date field
              const dateValue = record[dateField];
              if (!dateValue) continue;

              const recordDate = new Date(dateValue as string);
              if (isNaN(recordDate.getTime())) continue;

              // Determine bucket
              const bucketKey = getBucketKey(recordDate, gran);
              const state = buckets.get(bucketKey);

              if (state) {
                if (valueField === "*") {
                  state.count++;
                } else {
                  updateStreamingState(state, record[valueField]);
                }
              }
            }
          }

          nextLink = response["@odata.nextLink"];
        }

        // Build ordered list of values
        const orderedValues: number[] = [];
        const orderedPeriods: string[] = [];

        for (const periodStart of periodStarts) {
          const key = getBucketKey(periodStart, gran);
          const state = buckets.get(key)!;
          const value = finalizeStreamingValue(state, aggFunc);
          orderedValues.push(value);
          orderedPeriods.push(key);
        }

        // Calculate growth rates
        const growthRates = includeGrowthRate
          ? calculateGrowthRates(orderedValues)
          : orderedValues.map(() => null);

        // Calculate moving averages
        const movingAverages = movingAverageWindow && movingAverageWindow > 1
          ? calculateMovingAverages(orderedValues, movingAverageWindow)
          : orderedValues.map(() => null);

        // Build data points
        const dataPoints: TrendDataPoint[] = orderedPeriods.map((period, i) => ({
          period,
          value: orderedValues[i],
          growthRate: growthRates[i],
          movingAverage: movingAverages[i],
        }));

        const output = formatTrendingResults(
          dataPoints,
          entity,
          valueField,
          aggFunc,
          gran,
          movingAverageWindow !== undefined && movingAverageWindow > 1,
          movingAverageWindow
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
          message = `Trending error: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
