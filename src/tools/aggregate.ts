/**
 * Aggregation tool - performs SUM, AVG, COUNT, MIN, MAX on D365 data
 * Uses fast /$count for simple COUNT operations, client-side aggregation otherwise
 * (D365 F&O has limited $apply support, so we skip it to avoid timeouts)
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import type { EnvironmentManager } from "../environment-manager.js";
import { D365Client, D365Error } from "../d365-client.js";
import type { ODataResponse } from "../types.js";
import { formatTiming, ProgressReporter } from "../progress.js";
import { environmentSchema } from "./common.js";

/**
 * Timeout for paginated requests (60 seconds - longer than default 30s)
 * Can be configured via environment variable
 */
const PAGINATION_TIMEOUT_MS = parseInt(process.env.D365_PAGINATION_TIMEOUT_MS || "60000", 10);

/**
 * Maximum retries for individual page fetches within pagination
 */
const PAGE_FETCH_MAX_RETRIES = 2;

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch a single page with retry logic for pagination operations.
 * Uses longer timeout (60s) and retries with exponential backoff.
 * This is in addition to the client-level retry for a more robust pagination.
 */
async function fetchPageWithRetry<T>(
  client: D365Client,
  url: string,
  maxRetries: number = PAGE_FETCH_MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.request<T>(url, {}, PAGINATION_TIMEOUT_MS);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on non-retryable errors (auth, not found, bad request)
      if (error instanceof D365Error) {
        if (error.statusCode === 401 || error.statusCode === 403 ||
            error.statusCode === 404 || error.statusCode === 400) {
          throw error;
        }
      }

      if (attempt < maxRetries) {
        // Exponential backoff: 2s, 4s
        const backoffMs = 2000 * Math.pow(2, attempt);
        await sleep(backoffMs);
      }
    }
  }

  throw lastError || new Error("Page fetch failed after retries");
}

/**
 * Supported aggregation functions
 */
type AggregationFunction = "SUM" | "AVG" | "COUNT" | "MIN" | "MAX" | "COUNTDISTINCT" | "P50" | "P90" | "P95" | "P99";

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
 * Progress tracking for accurate mode
 */
interface AccurateModeProgress {
  pagesFetched: number;
  recordsProcessed: number;
  totalCount?: number;
  elapsedMs: number;
  isPartial?: boolean;
  partialReason?: string;
}

/**
 * Streaming aggregation state for a single aggregation
 */
interface StreamingAggState {
  sum: number;
  count: number;
  min: number;
  max: number;
  distinctSet?: Set<unknown>;
  values?: number[]; // For percentile calculations
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
 * Check if a function requires storing all values (for percentiles)
 */
function isPercentileFunction(func: AggregationFunction): boolean {
  return func === "P50" || func === "P90" || func === "P95" || func === "P99";
}

/**
 * Calculate percentile from sorted array
 */
function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sortedValues[lower];
  }

  // Linear interpolation
  const fraction = index - lower;
  return sortedValues[lower] + fraction * (sortedValues[upper] - sortedValues[lower]);
}

/**
 * Update streaming aggregation state with a new value
 */
function updateStreamingState(
  state: StreamingAggState,
  value: unknown,
  func: AggregationFunction
): void {
  if (func === "COUNTDISTINCT") {
    if (!state.distinctSet) {
      state.distinctSet = new Set();
    }
    state.distinctSet.add(value);
    return;
  }

  if (func === "COUNT") {
    state.count++;
    return;
  }

  // For SUM, AVG, MIN, MAX, and percentiles we need numeric values
  if (typeof value !== "number") {
    return;
  }

  state.count++;
  state.sum += value;

  if (value < state.min) {
    state.min = value;
  }
  if (value > state.max) {
    state.max = value;
  }

  // Store values for percentile calculations
  if (isPercentileFunction(func)) {
    if (!state.values) {
      state.values = [];
    }
    state.values.push(value);
  }
}

/**
 * Finalize streaming state to get the final aggregation value
 */
function finalizeStreamingValue(
  state: StreamingAggState,
  func: AggregationFunction
): number {
  switch (func) {
    case "COUNT":
      return state.count;
    case "COUNTDISTINCT":
      return state.distinctSet?.size ?? 0;
    case "SUM":
      return state.sum;
    case "AVG":
      return state.count > 0 ? state.sum / state.count : 0;
    case "MIN":
      return state.count > 0 ? state.min : 0;
    case "MAX":
      return state.count > 0 ? state.max : 0;
    case "P50":
      if (!state.values || state.values.length === 0) return 0;
      state.values.sort((a, b) => a - b);
      return calculatePercentile(state.values, 50);
    case "P90":
      if (!state.values || state.values.length === 0) return 0;
      state.values.sort((a, b) => a - b);
      return calculatePercentile(state.values, 90);
    case "P95":
      if (!state.values || state.values.length === 0) return 0;
      state.values.sort((a, b) => a - b);
      return calculatePercentile(state.values, 95);
    case "P99":
      if (!state.values || state.values.length === 0) return 0;
      state.values.sort((a, b) => a - b);
      return calculatePercentile(state.values, 99);
    default:
      return 0;
  }
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
 * Finalize streaming results into AggregationResult format
 */
function finalizeStreamingResults(
  stateMap: Map<string, Map<string, StreamingAggState>>,
  aggregations: AggregationSpec[],
  groupBy?: string[],
  groupKeyMap?: Map<string, Record<string, unknown>>
): AggregationResult[] {
  const results: AggregationResult[] = [];

  for (const [groupKeyStr, aggStates] of stateMap) {
    const values: Record<string, number> = {};

    for (const agg of aggregations) {
      const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;
      const state = aggStates.get(alias);
      if (state) {
        values[alias] = finalizeStreamingValue(state, agg.function);
      }
    }

    if (groupBy && groupBy.length > 0 && groupKeyMap) {
      results.push({
        groupKey: groupKeyMap.get(groupKeyStr),
        values,
      });
    } else {
      results.push({ values });
    }
  }

  return results;
}

/**
 * Format accurate mode result with progress metrics
 */
function formatAccurateModeResult(
  results: AggregationResult[],
  groupBy: string[] | undefined,
  progress: AccurateModeProgress
): string {
  const lines: string[] = [];

  // Header with progress info
  if (progress.isPartial) {
    lines.push("⚠️ PARTIAL RESULTS - Operation did not complete");
    lines.push(`Reason: ${progress.partialReason || "Unknown error"}`);
    lines.push("");
  }

  if (groupBy && groupBy.length > 0) {
    lines.push(`Aggregation Results - Accurate Mode (${results.length} groups)`);
  } else {
    lines.push("Aggregation Results - Accurate Mode");
  }
  lines.push(`Records processed: ${progress.recordsProcessed.toLocaleString()}`);
  if (progress.totalCount !== undefined) {
    lines.push(`Total available: ${progress.totalCount.toLocaleString()}`);
    if (progress.isPartial && progress.totalCount > progress.recordsProcessed) {
      const pct = ((progress.recordsProcessed / progress.totalCount) * 100).toFixed(1);
      lines.push(`Coverage: ${pct}% of total records`);
    }
  }
  lines.push(`Pages fetched: ${progress.pagesFetched}`);
  lines.push(`Time elapsed: ${(progress.elapsedMs / 1000).toFixed(1)}s`);
  lines.push("");

  // Results
  if (groupBy && groupBy.length > 0) {
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
 * Fetch all records with streaming aggregation (accurate mode)
 * Does not store all records in memory - aggregates as pages arrive
 * Uses per-page retry with 60s timeout for robustness on large datasets
 */
async function fetchAndAggregateStreaming(
  client: D365Client,
  entity: string,
  aggregations: AggregationSpec[],
  filter?: string,
  groupBy?: string[],
  progressReporter?: ProgressReporter
): Promise<{ results: AggregationResult[]; progress: AccurateModeProgress }> {
  const startTime = Date.now();

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

  // Extract fields needed
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

  // Build initial query - no $top for accurate mode (let D365 paginate naturally)
  // Add $count=true to get total count on first page
  const selectFields = Array.from(fieldsNeeded).join(",");
  let path = `/${entity}`;
  const queryParams: string[] = [];
  if (selectFields) {
    queryParams.push(`$select=${encodeURIComponent(selectFields)}`);
  }
  if (filter) {
    queryParams.push(`$filter=${encodeURIComponent(filter)}`);
  }
  queryParams.push("$count=true");
  if (queryParams.length > 0) {
    path += `?${queryParams.join("&")}`;
  }

  let nextLink: string | undefined = path;
  let pagesFetched = 0;
  let recordsProcessed = 0;
  let totalCount: number | undefined;
  let isPartial = false;
  let partialReason: string | undefined;

  // Fetch pages and aggregate with retry logic
  try {
    while (nextLink) {
      const response: ODataResponse<Record<string, unknown>> = await fetchPageWithRetry(client, nextLink);
      pagesFetched++;

      // Capture total count from first response
      if (pagesFetched === 1 && response["@odata.count"] !== undefined) {
        totalCount = response["@odata.count"];
      }

      if (response.value && Array.isArray(response.value)) {
        for (const record of response.value) {
          recordsProcessed++;

          // Determine group key
          // Use JSON.stringify to avoid collisions when values contain delimiter characters
          let groupKeyStr = "__all__";
          if (groupBy && groupBy.length > 0) {
            const keyParts = groupBy.map((field) => record[field] ?? null);
            groupKeyStr = JSON.stringify(keyParts);

            // Initialize group if new
            if (!stateMap.has(groupKeyStr)) {
              const aggStates = new Map<string, StreamingAggState>();
              for (const agg of aggregations) {
                const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;
                aggStates.set(alias, createStreamingState());
              }
              stateMap.set(groupKeyStr, aggStates);

              // Store actual group key values
              const groupKey: Record<string, unknown> = {};
              for (const field of groupBy) {
                groupKey[field] = record[field];
              }
              groupKeyMap.set(groupKeyStr, groupKey);
            }
          }

          // Update aggregations for this record
          const aggStates = stateMap.get(groupKeyStr)!;
          for (const agg of aggregations) {
            const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;
            const state = aggStates.get(alias)!;

            if (agg.field === "*") {
              // COUNT(*) - just increment count
              state.count++;
            } else {
              updateStreamingState(state, record[agg.field], agg.function);
            }
          }
        }
      }

      // Report progress every 10 pages
      if (progressReporter && pagesFetched % 10 === 0) {
        const totalInfo = totalCount !== undefined ? ` of ${totalCount.toLocaleString()}` : "";
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        await progressReporter.report(
          `Page ${pagesFetched}: ${recordsProcessed.toLocaleString()}${totalInfo} records (${elapsed}s)`
        );
      }

      nextLink = response["@odata.nextLink"];
    }
  } catch (error) {
    // On error, return partial results if we've processed any records
    if (recordsProcessed > 0) {
      isPartial = true;
      partialReason = error instanceof Error ? error.message : String(error);
    } else {
      throw error;
    }
  }

  // Finalize results
  const results = finalizeStreamingResults(stateMap, aggregations, groupBy, groupKeyMap);

  const progress: AccurateModeProgress = {
    pagesFetched,
    recordsProcessed,
    totalCount,
    elapsedMs: Date.now() - startTime,
    isPartial,
    partialReason,
  };

  return { results, progress };
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
    case "P50": {
      const sorted = [...values].sort((a, b) => a - b);
      return calculatePercentile(sorted, 50);
    }
    case "P90": {
      const sorted = [...values].sort((a, b) => a - b);
      return calculatePercentile(sorted, 90);
    }
    case "P95": {
      const sorted = [...values].sort((a, b) => a - b);
      return calculatePercentile(sorted, 95);
    }
    case "P99": {
      const sorted = [...values].sort((a, b) => a - b);
      return calculatePercentile(sorted, 99);
    }
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
      // Use JSON.stringify to avoid collisions when values contain delimiter characters
      const keyParts = groupBy.map((field) => record[field] ?? null);
      const key = JSON.stringify(keyParts);

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(record);
    }

    const results: AggregationResult[] = [];

    for (const [, groupRecords] of groups) {
      const groupKey: Record<string, unknown> = {};
      // Get actual values from the first record in the group
      groupBy.forEach((field) => {
        groupKey[field] = groupRecords[0]?.[field];
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
 * Apply sorting and limiting to aggregation results
 */
function applySortingAndLimiting(
  results: AggregationResult[],
  orderBy?: string,
  top?: number
): AggregationResult[] {
  let sortedResults = [...results];

  // Apply sorting if orderBy is specified
  if (orderBy) {
    const parts = orderBy.trim().split(/\s+/);
    const field = parts[0];
    const direction = parts[1]?.toLowerCase() || "asc";
    const desc = direction === "desc";

    sortedResults.sort((a, b) => {
      const aVal = a.values[field] ?? 0;
      const bVal = b.values[field] ?? 0;
      return desc ? bVal - aVal : aVal - bVal;
    });
  }

  // Apply top limit if specified
  if (top && top > 0) {
    sortedResults = sortedResults.slice(0, top);
  }

  return sortedResults;
}

/**
 * Sampling threshold - use sampling when total count exceeds this
 */
const SAMPLING_THRESHOLD = 100000;

/**
 * Sample size for statistical estimation
 */
const SAMPLE_SIZE = 10000;

/**
 * Fetch a random sample for statistical estimation
 * Uses $skip with random offset to get a distributed sample
 */
async function fetchSampledAggregation(
  client: D365Client,
  entity: string,
  aggregations: AggregationSpec[],
  totalCount: number,
  filter?: string,
  groupBy?: string[],
  progressReporter?: ProgressReporter
): Promise<{ results: AggregationResult[]; sampleSize: number; totalCount: number; elapsedMs: number }> {
  const startTime = Date.now();

  // Extract fields needed
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

  const selectFields = Array.from(fieldsNeeded).join(",");
  const allRecords: Record<string, unknown>[] = [];

  // Calculate how many chunks to sample from
  const numChunks = Math.min(10, Math.ceil(totalCount / SAMPLE_SIZE));
  const chunkSize = Math.floor(totalCount / numChunks);
  const recordsPerChunk = Math.ceil(SAMPLE_SIZE / numChunks);

  if (progressReporter) {
    await progressReporter.report(`Sampling ${SAMPLE_SIZE.toLocaleString()} records from ${totalCount.toLocaleString()} total...`);
  }

  // Fetch samples from different parts of the dataset
  for (let i = 0; i < numChunks; i++) {
    const skipOffset = i * chunkSize;

    let path = `/${entity}?$top=${recordsPerChunk}&$skip=${skipOffset}`;
    if (selectFields) {
      path += `&$select=${encodeURIComponent(selectFields)}`;
    }
    if (filter) {
      path += `&$filter=${encodeURIComponent(filter)}`;
    }

    try {
      const response: ODataResponse<Record<string, unknown>> = await fetchPageWithRetry(client, path);
      if (response.value && Array.isArray(response.value)) {
        allRecords.push(...response.value);
      }
    } catch {
      // Skip failed chunks, continue sampling
    }

    if (allRecords.length >= SAMPLE_SIZE) {
      break;
    }
  }

  // Perform aggregation on sample
  const results = performClientSideAggregation(allRecords.slice(0, SAMPLE_SIZE), aggregations, groupBy);

  // Scale up results based on sampling ratio (for SUM only)
  const scaleFactor = totalCount / allRecords.length;
  for (const result of results) {
    for (const agg of aggregations) {
      const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field === "*" ? "all" : agg.field}`;
      if (agg.function === "SUM" || agg.function === "COUNT") {
        result.values[alias] = Math.round(result.values[alias] * scaleFactor);
      }
      // AVG, MIN, MAX, percentiles don't need scaling
    }
  }

  return {
    results,
    sampleSize: allRecords.length,
    totalCount,
    elapsedMs: Date.now() - startTime,
  };
}

/**
 * Format sampling mode result
 */
function formatSamplingResult(
  results: AggregationResult[],
  groupBy: string[] | undefined,
  sampleSize: number,
  totalCount: number,
  elapsedMs: number
): string {
  const lines: string[] = [];

  lines.push("⚡ ESTIMATED RESULTS (Sampling Mode)");
  lines.push(`Sample: ${sampleSize.toLocaleString()} of ${totalCount.toLocaleString()} records (${((sampleSize / totalCount) * 100).toFixed(1)}%)`);
  lines.push(`Time: ${(elapsedMs / 1000).toFixed(1)}s`);
  lines.push("");
  lines.push("Note: SUM and COUNT values are extrapolated estimates.");
  lines.push("Use accurate=true for precise totals (will take longer).");
  lines.push("");

  if (groupBy && groupBy.length > 0) {
    for (const result of results) {
      const groupDesc = groupBy
        .map((field) => `${field}=${result.groupKey?.[field] ?? "null"}`)
        .join(", ");
      lines.push(`[${groupDesc}]`);

      for (const [alias, value] of Object.entries(result.values)) {
        const formattedValue = Number.isInteger(value)
          ? `~${value.toLocaleString()}`
          : `~${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
        lines.push(`  ${alias}: ${formattedValue}`);
      }
      lines.push("");
    }
  } else {
    const result = results[0];
    if (result) {
      for (const [alias, value] of Object.entries(result.values)) {
        const formattedValue = Number.isInteger(value)
          ? `~${value.toLocaleString()}`
          : `~${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
        lines.push(`${alias}: ${formattedValue}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Register the aggregate tool
 */
export function registerAggregateTool(server: McpServer, envManager: EnvironmentManager): void {
  server.tool(
    "aggregate",
    `Perform aggregations (SUM, AVG, COUNT, MIN, MAX, COUNTDISTINCT, P50, P90, P95, P99) on D365 entity data.

Uses fast /$count endpoint for simple COUNT operations, client-side aggregation for other operations.
Default mode caps at 5K records for quick estimates. Use accurate=true to fetch ALL records for precise totals.

For very large datasets (100K+ records), use sampling=true for fast statistical estimates.

Supports orderBy and top parameters for ranked results (e.g., "top 20 customers by sales").
Percentiles: P50 (median), P90, P95, P99 are useful for understanding value distributions.

Examples:
- Count all customers: entity="CustomersV3", aggregations=[{function: "COUNT", field: "*"}]
- Sum line amounts: entity="SalesOrderLines", aggregations=[{function: "SUM", field: "LineAmount"}]
- Median order value: entity="SalesOrderLines", aggregations=[{function: "P50", field: "LineAmount"}], accurate=true
- P90 order value: entity="SalesOrderLines", aggregations=[{function: "P90", field: "LineAmount"}], accurate=true
- Accurate sum (all records): entity="SalesOrderLines", aggregations=[{function: "SUM", field: "LineAmount"}], accurate=true
- Fast estimate on large dataset: sampling=true (uses ~10K record sample for statistical estimate)
- Multiple aggregations: aggregations=[{function: "SUM", field: "LineAmount"}, {function: "AVG", field: "LineAmount"}]
- With filter: filter="SalesOrderNumber eq 'SO-001'"
- Group by: groupBy=["ItemNumber"] to get aggregations per item
- Top customers: groupBy=["CustomerAccount"], orderBy="sum_Amount desc", top=20`,
    {
      entity: z.string().describe("Entity name to aggregate (e.g., 'SalesOrderLines')"),
      aggregations: z.array(
        z.object({
          function: z.enum(["SUM", "AVG", "COUNT", "MIN", "MAX", "COUNTDISTINCT", "P50", "P90", "P95", "P99"]).describe("Aggregation function (P50=median, P90/P95/P99=percentiles)"),
          field: z.string().describe("Field to aggregate (use '*' for COUNT)"),
          alias: z.string().optional().describe("Optional result alias"),
        })
      ).min(1).describe("Array of aggregation specifications"),
      filter: z.string().optional().describe("OData $filter expression"),
      groupBy: z.array(z.string()).optional().describe("Fields to group by"),
      maxRecords: z.number().optional().default(DEFAULT_MAX_RECORDS).describe(
        `Maximum records for client-side fallback (default: ${DEFAULT_MAX_RECORDS})`
      ),
      accurate: z.boolean().optional().default(false).describe(
        "When true, fetches ALL records for exact aggregation (no 5K limit). Shows progress metrics."
      ),
      sampling: z.boolean().optional().default(false).describe(
        "Use statistical sampling for fast estimates on very large datasets (100K+ records). Returns extrapolated estimates."
      ),
      orderBy: z.string().optional().describe(
        "Sort results by aggregation alias, e.g. 'sum_LineAmount desc' or 'total_sales asc'"
      ),
      top: z.number().optional().describe(
        "Return only top N results after sorting (useful for 'top customers' queries)"
      ),
      environment: environmentSchema,
    },
    async ({ entity, aggregations, filter, groupBy, maxRecords, accurate, sampling, orderBy, top, environment }, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const client = envManager.getClient(environment);
      try {
        const startTime = Date.now();
        const progressReporter = new ProgressReporter(server, "aggregate", extra.sessionId);

        // Check if this is a simple COUNT(*) with no groupBy
        const isSimpleCount =
          aggregations.length === 1 &&
          aggregations[0].function === "COUNT" &&
          aggregations[0].field === "*" &&
          (!groupBy || groupBy.length === 0);

        // Fast path: use /$count endpoint for simple COUNT operations
        // This works regardless of accurate mode since /$count is always accurate
        if (isSimpleCount && !sampling) {
          const count = await tryFastCount(client, entity, filter);
          if (count !== null) {
            const alias = aggregations[0].alias || "count_all";
            const timing = formatTiming(Date.now() - startTime);
            return {
              content: [
                {
                  type: "text",
                  text: `Aggregation Results\nMethod: Server-side (/$count)${timing}\n\n${alias}: ${count.toLocaleString()}`,
                },
              ],
            };
          }
        }

        // Sampling mode: use statistical sampling for very large datasets
        if (sampling) {
          await progressReporter.report("Getting total count for sampling...");
          const totalCount = await tryFastCount(client, entity, filter);

          if (totalCount === null) {
            return {
              content: [{ type: "text", text: "Unable to get total count for sampling. Try without sampling=true." }],
              isError: true,
            };
          }

          if (totalCount < SAMPLING_THRESHOLD) {
            // Dataset is small enough, just fetch all with accurate mode
            await progressReporter.report(`Dataset has ${totalCount.toLocaleString()} records, using accurate mode instead of sampling.`);
          } else {
            const { results, sampleSize, elapsedMs } = await fetchSampledAggregation(
              client,
              entity,
              aggregations,
              totalCount,
              filter,
              groupBy,
              progressReporter
            );

            // Apply sorting and limiting
            const sortedResults = applySortingAndLimiting(results, orderBy, top);

            const output = formatSamplingResult(sortedResults, groupBy, sampleSize, totalCount, elapsedMs);

            return {
              content: [
                {
                  type: "text",
                  text: output,
                },
              ],
            };
          }
        }

        // Accurate mode: fetch ALL records with streaming aggregation
        if (accurate || sampling) {
          await progressReporter.report("Starting accurate aggregation (fetching all records)...");

          const { results, progress } = await fetchAndAggregateStreaming(
            client,
            entity,
            aggregations,
            filter,
            groupBy,
            progressReporter
          );

          // Apply sorting and limiting
          const sortedResults = applySortingAndLimiting(results, orderBy, top);

          const output = formatAccurateModeResult(sortedResults, groupBy, progress);

          return {
            content: [
              {
                type: "text",
                text: output,
              },
            ],
          };
        }

        // Default mode: client-side aggregation capped at maxRecords
        // Skip $apply - D365 F&O has limited support and it causes timeouts

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

        // Apply sorting and limiting
        const sortedResults = applySortingAndLimiting(results, orderBy, top);

        const output = formatAggregationResult(sortedResults, groupBy, "client", records.length);

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
