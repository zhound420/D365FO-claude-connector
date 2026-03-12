/**
 * Shared pagination utilities for D365 OData queries
 * Eliminates duplicated fetchPageWithRetry and pagination loop logic
 */

import { D365Client, D365Error } from "../d365-client.js";
import type { ODataResponse } from "../types.js";
import type { ProgressReporter } from "../progress.js";
import { parseEnvInt } from "./env-utils.js";

/**
 * Timeout for paginated requests (60 seconds - longer than default 30s)
 */
export const PAGINATION_TIMEOUT_MS = parseEnvInt("D365_PAGINATION_TIMEOUT_MS", 60000, 1000);

/**
 * Maximum retries for individual page fetches within pagination
 */
export const PAGE_FETCH_MAX_RETRIES = 2;

/**
 * Non-retryable HTTP status codes (auth, not found, bad request)
 */
const NON_RETRYABLE_STATUS_CODES = [400, 401, 403, 404];

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch a single page with retry logic for pagination operations.
 * Uses longer timeout (60s) and retries with exponential backoff.
 * Non-retryable errors (401, 403, 404, 400) are thrown immediately.
 */
export async function fetchPageWithRetry<T>(
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
        if (NON_RETRYABLE_STATUS_CODES.includes(error.statusCode)) {
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
 * Options for paginated fetch
 */
export interface PaginatedFetchOptions {
  /** Maximum total records to fetch */
  maxRecords: number;
  /** Progress reporter for status updates */
  progress?: ProgressReporter;
  /** Label prefix for progress messages */
  label?: string;
  /** Whether to ensure $count=true is in the initial path */
  ensureCount?: boolean;
}

/**
 * Result of a paginated fetch
 */
export interface PaginatedFetchResult<T = Record<string, unknown>> {
  records: T[];
  totalCount?: number;
  pagesFetched: number;
  truncated: boolean;
  elapsedMs: number;
}

/**
 * Full paginated fetch with progress reporting, max records limiting, and retry.
 * Handles the complete pagination loop used across many tools.
 */
export async function paginatedFetch<T = Record<string, unknown>>(
  client: D365Client,
  initialPath: string,
  options: PaginatedFetchOptions
): Promise<PaginatedFetchResult<T>> {
  const startTime = Date.now();
  const allRecords: T[] = [];
  let pagesFetched = 0;
  let totalCount: number | undefined;
  let truncated = false;

  // Ensure $count=true is in the path for first request
  let currentPath = initialPath;
  if (options.ensureCount !== false && !currentPath.includes("$count=true") && !currentPath.includes("/$count")) {
    currentPath += currentPath.includes("?") ? "&$count=true" : "?$count=true";
  }

  let nextLink: string | undefined = currentPath;

  while (nextLink) {
    const response: ODataResponse<T> = await fetchPageWithRetry(client, nextLink);
    pagesFetched++;

    // Capture total count from first response
    if (pagesFetched === 1 && response["@odata.count"] !== undefined) {
      totalCount = response["@odata.count"];
    }

    if (response.value && Array.isArray(response.value)) {
      allRecords.push(...response.value);
    }

    // Report progress
    if (options.progress && pagesFetched > 1) {
      const totalInfo = totalCount !== undefined ? ` of ${totalCount.toLocaleString()}` : "";
      const labelPrefix = options.label ? `[${options.label}] ` : "";
      await options.progress.report(
        `${labelPrefix}Fetching page ${pagesFetched}... (${allRecords.length.toLocaleString()}${totalInfo} records)`
      );
    }

    // Check if we've hit the max records limit
    if (allRecords.length >= options.maxRecords) {
      truncated = true;
      break;
    }

    nextLink = response["@odata.nextLink"];
  }

  return {
    records: allRecords.slice(0, options.maxRecords),
    totalCount,
    pagesFetched,
    truncated,
    elapsedMs: Date.now() - startTime,
  };
}
