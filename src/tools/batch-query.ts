/**
 * Batch Query tool - execute multiple D365 OData queries in parallel
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
 * Limits for batch queries
 */
const MAX_QUERIES = parseInt(process.env.D365_MAX_BATCH_QUERIES || "10", 10);
const DEFAULT_TOP = 100;
const DEFAULT_MAX_RECORDS = 5000;
const MAX_CONCURRENT_REQUESTS = parseInt(process.env.D365_BATCH_CONCURRENCY || "5", 10);

/**
 * Timeout for paginated requests (60 seconds - longer than default 30s)
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

      if (error instanceof D365Error) {
        if (error.statusCode === 401 || error.statusCode === 403 ||
            error.statusCode === 404 || error.statusCode === 400) {
          throw error;
        }
      }

      if (attempt < maxRetries) {
        const backoffMs = 2000 * Math.pow(2, attempt);
        await sleep(backoffMs);
      }
    }
  }

  throw lastError || new Error("Page fetch failed after retries");
}

/**
 * Schema for a single query in the batch
 */
const BatchQueryItemSchema = z.object({
  name: z.string().optional().describe("Optional label for this query result"),
  entity: z.string().describe("Entity name (e.g., 'SalesOrderHeadersV2')"),
  filter: z.string().optional().describe("OData $filter expression"),
  select: z.array(z.string()).optional().describe("Fields to include in results"),
  top: z.number().optional().default(DEFAULT_TOP).describe(`Limit records (default: ${DEFAULT_TOP})`),
  orderby: z.string().optional().describe("OData $orderby expression"),
  fetchAll: z.boolean().optional().default(false).describe("Auto-paginate all pages (default: false)"),
  maxRecords: z.number().optional().default(DEFAULT_MAX_RECORDS).describe(`Max records when fetchAll=true (default: ${DEFAULT_MAX_RECORDS})`),
});

type BatchQueryItem = z.infer<typeof BatchQueryItemSchema>;

/**
 * Result of a single query execution
 */
interface QueryResult {
  name: string;
  entity: string;
  success: boolean;
  records?: unknown[];
  totalCount?: number;
  error?: string;
  elapsedMs: number;
}

/**
 * Build OData query path from batch query item
 */
function buildQueryPath(query: BatchQueryItem): string {
  const params: string[] = [];

  if (query.filter) {
    params.push(`$filter=${encodeURIComponent(query.filter)}`);
  }
  if (query.select && query.select.length > 0) {
    params.push(`$select=${encodeURIComponent(query.select.join(","))}`);
  }
  if (query.orderby) {
    params.push(`$orderby=${encodeURIComponent(query.orderby)}`);
  }
  if (!query.fetchAll && query.top) {
    params.push(`$top=${query.top}`);
  }
  params.push("$count=true");

  const queryString = params.length > 0 ? `?${params.join("&")}` : "";
  return `/${query.entity}${queryString}`;
}

/**
 * Execute a single query with pagination support
 * Uses per-page retry with 60s timeout for robustness on large datasets
 */
async function executeWithPagination(
  client: D365Client,
  query: BatchQueryItem,
  progress: ProgressReporter
): Promise<QueryResult> {
  const startTime = Date.now();
  const queryName = query.name || query.entity;
  const maxRecords = query.maxRecords || DEFAULT_MAX_RECORDS;

  try {
    const allRecords: unknown[] = [];
    let pagesFetched = 0;
    let totalCount: number | undefined;

    let currentPath = buildQueryPath(query);
    let nextLink: string | undefined = currentPath;

    while (nextLink) {
      const response: ODataResponse = await fetchPageWithRetry(client, nextLink);
      pagesFetched++;

      if (pagesFetched === 1 && response["@odata.count"] !== undefined) {
        totalCount = response["@odata.count"];
      }

      if (response.value && Array.isArray(response.value)) {
        allRecords.push(...response.value);
      }

      if (pagesFetched > 1) {
        const totalInfo = totalCount !== undefined ? ` of ${totalCount.toLocaleString()}` : "";
        await progress.report(`[${queryName}] Fetching page ${pagesFetched}... (${allRecords.length.toLocaleString()}${totalInfo} records)`);
      }

      if (allRecords.length >= maxRecords) {
        break;
      }

      nextLink = response["@odata.nextLink"];
    }

    return {
      name: queryName,
      entity: query.entity,
      success: true,
      records: allRecords.slice(0, maxRecords),
      totalCount,
      elapsedMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name: queryName,
      entity: query.entity,
      success: false,
      error: formatError(error),
      elapsedMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute a single query without pagination
 * Uses longer timeout for consistency with paginated queries
 */
async function executeSingleQuery(
  client: D365Client,
  query: BatchQueryItem
): Promise<QueryResult> {
  const startTime = Date.now();
  const queryName = query.name || query.entity;

  try {
    const path = buildQueryPath(query);
    const response: ODataResponse = await client.request(path, {}, PAGINATION_TIMEOUT_MS);

    return {
      name: queryName,
      entity: query.entity,
      success: true,
      records: response.value,
      totalCount: response["@odata.count"],
      elapsedMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name: queryName,
      entity: query.entity,
      success: false,
      error: formatError(error),
      elapsedMs: Date.now() - startTime,
    };
  }
}

/**
 * Format error message from various error types
 */
function formatError(error: unknown): string {
  if (error instanceof D365Error) {
    let message = error.message;
    if (error.statusCode === 429 && error.retryAfter) {
      message += ` (retry after ${error.retryAfter}s)`;
    }
    return message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Execute a query (with or without pagination)
 */
async function executeQuery(
  client: D365Client,
  query: BatchQueryItem,
  progress: ProgressReporter
): Promise<QueryResult> {
  if (query.fetchAll) {
    return executeWithPagination(client, query, progress);
  }
  return executeSingleQuery(client, query);
}

/**
 * Execute tasks with concurrency limit
 */
async function executeWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const p = task().then((result) => {
      results[i] = result;
    });

    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove completed promises
      for (let j = executing.length - 1; j >= 0; j--) {
        if (executing[j] !== undefined) {
          // Check if promise is settled by racing with immediate resolve
          const settled = await Promise.race([
            executing[j].then(() => true, () => true),
            Promise.resolve(false),
          ]);
          if (settled) {
            executing.splice(j, 1);
          }
        }
      }
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Resolve name collisions by adding numeric suffixes
 */
function resolveNameCollisions(queries: BatchQueryItem[]): BatchQueryItem[] {
  const nameCounts = new Map<string, number>();

  return queries.map(query => {
    const baseName = query.name || query.entity;
    const count = nameCounts.get(baseName) || 0;
    nameCounts.set(baseName, count + 1);

    if (count > 0) {
      return { ...query, name: `${baseName}_${count + 1}` };
    }
    return { ...query, name: baseName };
  });
}

/**
 * Execute all queries in parallel
 */
async function executeBatchQueries(
  client: D365Client,
  queries: BatchQueryItem[],
  stopOnError: boolean,
  progress: ProgressReporter
): Promise<QueryResult[]> {
  await progress.report(`Executing ${queries.length} queries in parallel...`);

  // Resolve name collisions
  const resolvedQueries = resolveNameCollisions(queries);

  if (stopOnError) {
    // Sequential execution with early termination
    const results: QueryResult[] = [];
    for (const query of resolvedQueries) {
      const result = await executeQuery(client, query, progress);
      results.push(result);
      if (!result.success) {
        // Mark remaining queries as not executed
        const remainingIndex = resolvedQueries.indexOf(query) + 1;
        for (let i = remainingIndex; i < resolvedQueries.length; i++) {
          const q = resolvedQueries[i];
          results.push({
            name: q.name || q.entity,
            entity: q.entity,
            success: false,
            error: "Skipped due to previous error (stopOnError=true)",
            elapsedMs: 0,
          });
        }
        break;
      }
    }
    return results;
  }

  // Parallel execution with concurrency limit
  const tasks = resolvedQueries.map(q => () => executeQuery(client, q, progress));
  const results = await executeWithConcurrencyLimit(tasks, MAX_CONCURRENT_REQUESTS);

  return results;
}

/**
 * Format batch results for output
 */
function formatBatchResults(results: QueryResult[], totalElapsedMs: number, envHeader?: string): string {
  const successCount = results.filter(r => r.success).length;
  const failedCount = results.length - successCount;

  const lines: string[] = [];

  // Environment header
  if (envHeader) {
    lines.push(envHeader);
    lines.push("");
  }

  // Header
  lines.push("Batch Query Results");
  let summary = `Completed: ${successCount}/${results.length} queries`;
  if (failedCount > 0) {
    summary += ` (${failedCount} failed)`;
  }
  summary += ` (${(totalElapsedMs / 1000).toFixed(1)}s)`;
  lines.push(summary);
  lines.push("");

  // Per-query results
  for (const result of results) {
    lines.push(`## ${result.name} (${result.entity})`);

    if (result.success) {
      const recordCount = result.records?.length || 0;
      let countLine = `Found ${recordCount.toLocaleString()} record(s)`;
      if (result.totalCount !== undefined && result.totalCount > recordCount) {
        countLine += ` of ${result.totalCount.toLocaleString()} total`;
      }
      lines.push(countLine);

      if (result.records && result.records.length > 0) {
        lines.push(JSON.stringify(result.records, null, 2));
      } else {
        lines.push("(no records)");
      }
    } else {
      lines.push(`ERROR: ${result.error}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * Register the batch_query tool
 */
export function registerBatchQueryTool(server: McpServer, envManager: EnvironmentManager): void {
  server.tool(
    "batch_query",
    `Execute multiple D365 OData queries in parallel, returning all results in a single response.

Features:
- Execute up to ${MAX_QUERIES} queries simultaneously
- Each query can have its own filter, select, orderby, and pagination settings
- Use fetchAll=true on individual queries to auto-paginate large result sets
- Continue execution even when individual queries fail (unless stopOnError=true)

Example:
{
  "queries": [
    { "name": "recent_orders", "entity": "SalesOrderHeadersV2", "top": 10, "orderby": "CreatedDateTime desc" },
    { "name": "customers", "entity": "CustomersV3", "filter": "CustomerGroup eq 'US'", "select": ["CustomerAccount", "CustomerName"] },
    { "name": "all_invoices", "entity": "SalesInvoiceHeadersV2", "fetchAll": true, "maxRecords": 1000 }
  ]
}`,
    {
      queries: z.array(BatchQueryItemSchema).min(1).max(MAX_QUERIES).describe(
        `Array of queries to execute (1-${MAX_QUERIES} queries)`
      ),
      stopOnError: z.boolean().optional().default(false).describe(
        "Stop execution on first failure (default: false - continue with remaining queries)"
      ),
      environment: environmentSchema,
    },
    async (
      { queries, stopOnError, environment },
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>
    ) => {
      const client = envManager.getClient(environment);
      const envConfig = envManager.getEnvironmentConfig(environment);
      const progress = new ProgressReporter(server, "batch_query", extra.sessionId);
      const startTime = Date.now();

      try {
        // Validate: non-empty queries array
        if (!queries || queries.length === 0) {
          return {
            content: [{ type: "text", text: "Error: No queries provided" }],
            isError: true,
          };
        }

        // Validate entity names are provided
        for (let i = 0; i < queries.length; i++) {
          if (!queries[i].entity || queries[i].entity.trim() === "") {
            return {
              content: [{ type: "text", text: `Error: Query at index ${i} is missing entity name` }],
              isError: true,
            };
          }
        }

        // Suggest execute_odata for single query
        if (queries.length === 1) {
          await progress.report("Note: For single queries, consider using execute_odata instead");
        }

        // Execute all queries
        const results = await executeBatchQueries(client, queries, stopOnError, progress);
        const totalElapsedMs = Date.now() - startTime;

        // Format results
        const envHeader = formatEnvironmentHeader(envConfig.name, envConfig.displayName, envConfig.type === "production");
        const output = formatBatchResults(results, totalElapsedMs, envHeader);

        // Determine if this should be marked as an error
        const allFailed = results.every(r => !r.success);
        const anyFailed = results.some(r => !r.success);

        return {
          content: [{ type: "text", text: output }],
          isError: allFailed || (stopOnError && anyFailed),
        };
      } catch (error) {
        const message = error instanceof D365Error
          ? error.message
          : `Batch query error: ${error instanceof Error ? error.message : String(error)}`;

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
