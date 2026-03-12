/**
 * D365 Finance & Operations OData API Client
 */

import type {
  D365Config,
  ODataResponse,
  ODataError,
  QueryParams,
  QueryResult,
} from "./types.js";
import { TokenManager } from "./auth.js";
import { log, logError } from "./config.js";

/**
 * Callback type for metrics collection
 */
export type MetricsCallback = (latencyMs: number, success: boolean) => void;

/**
 * Custom error class for D365 API errors
 */
export class D365Error extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public odataError?: ODataError["error"],
    public retryAfter?: number
  ) {
    super(message);
    this.name = "D365Error";
  }
}

/**
 * Batch operation for $batch endpoint
 */
export interface BatchOperation {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  data?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Batch response for a single operation
 */
export interface BatchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: unknown;
}

/**
 * Build multipart/mixed body for $batch request
 */
function buildBatchBody(operations: BatchOperation[], boundary: string): string {
  const changesetBoundary = `changeset_${generateCorrelationId()}`;
  const parts: string[] = [];

  parts.push(`--${boundary}`);
  parts.push(`Content-Type: multipart/mixed; boundary=${changesetBoundary}`);
  parts.push("");

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    parts.push(`--${changesetBoundary}`);
    parts.push("Content-Type: application/http");
    parts.push("Content-Transfer-Encoding: binary");
    parts.push(`Content-ID: ${i + 1}`);
    parts.push("");

    const path = op.path.startsWith("/") ? `/data${op.path}` : `/data/${op.path}`;
    parts.push(`${op.method} ${path} HTTP/1.1`);
    parts.push("Content-Type: application/json");
    parts.push("Accept: application/json");
    if (op.headers) {
      for (const [key, value] of Object.entries(op.headers)) {
        parts.push(`${key}: ${value}`);
      }
    }
    parts.push("");

    if (op.data) {
      parts.push(JSON.stringify(op.data));
    }
    parts.push("");
  }

  parts.push(`--${changesetBoundary}--`);
  parts.push(`--${boundary}--`);

  return parts.join("\r\n");
}

/**
 * Extract boundary string from Content-Type header
 */
function extractBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=([^\s;]+)/);
  return match ? match[1] : null;
}

/**
 * Parse $batch response into individual responses
 */
function parseBatchResponse(responseText: string, boundary: string): BatchResponse[] {
  const results: BatchResponse[] = [];
  const parts = responseText.split(`--${boundary}`).filter(
    p => p.trim() !== "" && p.trim() !== "--"
  );

  for (const part of parts) {
    // Find the HTTP response line within the part
    const httpMatch = part.match(/HTTP\/1\.\d\s+(\d+)\s+(.*)/);
    if (!httpMatch) continue;

    const status = parseInt(httpMatch[1], 10);
    const statusText = httpMatch[2].trim();
    const headers: Record<string, string> = {};

    // Parse headers after the HTTP status line
    const lines = part.split(/\r?\n/);
    let bodyStartIndex = -1;
    let inHttpHeaders = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("HTTP/")) {
        inHttpHeaders = true;
        continue;
      }
      if (inHttpHeaders) {
        if (lines[i].trim() === "") {
          bodyStartIndex = i + 1;
          break;
        }
        const headerMatch = lines[i].match(/^([^:]+):\s*(.+)/);
        if (headerMatch) {
          headers[headerMatch[1].toLowerCase()] = headerMatch[2].trim();
        }
      }
    }

    // Parse body
    let body: unknown = undefined;
    if (bodyStartIndex > 0) {
      const bodyText = lines.slice(bodyStartIndex).join("\n").trim();
      if (bodyText) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
      }
    }

    results.push({ status, statusText, headers, body });
  }

  return results;
}

/**
 * Default request timeout in milliseconds
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Maximum retry attempts for transient failures
 */
const MAX_RETRIES = 3;

/**
 * Base delay for exponential backoff (ms)
 */
const BASE_RETRY_DELAY_MS = 1000;

/**
 * HTTP status codes that should trigger a retry
 */
const RETRYABLE_STATUS_CODES = [429, 502, 503, 504];

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a unique correlation ID for request tracing
 */
function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `d365-${timestamp}-${random}`;
}

/**
 * D365 OData API Client
 */
export class D365Client {
  private config: D365Config;
  private tokenManager: TokenManager;
  private baseUrl: string;
  private metricsCallback?: MetricsCallback;

  constructor(config: D365Config) {
    this.config = config;
    this.tokenManager = new TokenManager(config);
    this.baseUrl = `${config.environmentUrl}/data`;
  }

  /**
   * Set a callback for metrics collection
   * Called after each request with latency and success status
   */
  setMetricsCallback(callback: MetricsCallback): void {
    this.metricsCallback = callback;
  }

  /**
   * Make an authenticated request to the D365 OData API
   * Includes automatic timeout and retry with exponential backoff
   */
  async request<T>(
    path: string,
    options: RequestInit = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const correlationId = generateCorrelationId();
    let lastError: Error | null = null;
    const requestStartTime = Date.now();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const token = await this.tokenManager.getToken();

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "OData-MaxVersion": "4.0",
              "OData-Version": "4.0",
              "x-correlation-id": correlationId,
              ...options.headers,
            },
          });

          clearTimeout(timeoutId);

          // Handle error responses
          if (!response.ok) {
            // Check if this is a retryable error
            if (RETRYABLE_STATUS_CODES.includes(response.status) && attempt < MAX_RETRIES) {
              // Get retry delay from Retry-After header or use exponential backoff
              let retryDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
              const retryAfterHeader = response.headers.get("Retry-After");
              if (retryAfterHeader) {
                const retryAfterSeconds = parseInt(retryAfterHeader, 10);
                if (!isNaN(retryAfterSeconds)) {
                  retryDelay = retryAfterSeconds * 1000;
                }
              }
              log(`Request failed with status ${response.status}, retrying in ${retryDelay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
              await sleep(retryDelay);
              continue;
            }
            // Record failed request in metrics before throwing
            this.recordMetrics(requestStartTime, false);
            await this.handleErrorResponse(response);
          }

          // Record successful request in metrics
          this.recordMetrics(requestStartTime, true);

          // Handle empty responses (e.g., 204 No Content)
          if (response.status === 204) {
            return undefined as T;
          }

          // Check content type for $count responses (returns plain text)
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("text/plain")) {
            const text = await response.text();
            return parseInt(text, 10) as T;
          }

          return response.json() as Promise<T>;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        // Handle timeout/abort errors
        if (error instanceof Error && error.name === "AbortError") {
          lastError = new D365Error(`Request timed out after ${timeoutMs}ms [${correlationId}]`, 0);
          if (attempt < MAX_RETRIES) {
            const retryDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
            log(`Request timed out [${correlationId}], retrying in ${retryDelay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await sleep(retryDelay);
            continue;
          }
        } else if (error instanceof D365Error) {
          // Add correlation ID to existing D365Error
          error.message = `${error.message} [${correlationId}]`;
          throw error;
        } else {
          lastError = error instanceof Error ? error : new Error(String(error));
          // Network errors are retryable
          if (attempt < MAX_RETRIES) {
            const retryDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
            log(`Network error [${correlationId}], retrying in ${retryDelay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await sleep(retryDelay);
            continue;
          }
        }
      }
    }

    // All retries exhausted - record failure in metrics
    this.recordMetrics(requestStartTime, false);
    throw lastError || new D365Error(`Request failed after all retries [${correlationId}]`, 0);
  }

  /**
   * Record metrics for a completed request
   */
  private recordMetrics(startTime: number, success: boolean): void {
    if (this.metricsCallback) {
      const latencyMs = Date.now() - startTime;
      this.metricsCallback(latencyMs, success);
    }
  }

  /**
   * Handle error responses from D365
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage = `Request failed with status ${response.status}`;
    let odataError: ODataError["error"] | undefined;
    let retryAfter: number | undefined;

    // Parse error body
    try {
      const errorBody = (await response.json()) as ODataError;
      if (errorBody.error) {
        odataError = errorBody.error;
        errorMessage = errorBody.error.message;
      }
    } catch {
      // Body might not be JSON
    }

    // Map status codes to user-friendly messages
    switch (response.status) {
      case 401:
        this.tokenManager.invalidateToken();
        errorMessage = "Authentication failed. Please check your D365 credentials (tenant ID, client ID, client secret).";
        break;
      case 403:
        errorMessage = "Access denied. The application may not have sufficient permissions for this operation.";
        break;
      case 404:
        errorMessage = `Resource not found. ${odataError?.message || "The entity or record may not exist. Use list_entities to discover available entities."}`;
        break;
      case 429:
        retryAfter = parseInt(response.headers.get("Retry-After") || "60", 10);
        errorMessage = `Rate limited. Please wait ${retryAfter} seconds before retrying.`;
        break;
      case 400:
        if (odataError?.message) {
          errorMessage = `Bad request: ${odataError.message}`;
        }
        break;
    }

    throw new D365Error(errorMessage, response.status, odataError, retryAfter);
  }

  /**
   * Fetch list of available entities from OData root
   * Much faster than $metadata for just getting entity names
   */
  async fetchEntityList(): Promise<string[]> {
    log("Fetching D365 entity list...");
    const response = await this.request<{ value: Array<{ name: string; url: string }> }>("/");
    return response.value.map((e) => e.name);
  }

  /**
   * Fetch a sample record to infer entity schema
   * Much faster than full $metadata (~2s vs 30-60s)
   */
  async fetchEntitySample(entityName: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.request<{ value: Record<string, unknown>[] }>(
        `/${entityName}?$top=1`
      );
      return response.value?.[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch metadata EDMX document
   */
  async fetchMetadata(): Promise<string> {
    log("Fetching D365 metadata (this may take a while for large environments)...");
    const token = await this.tokenManager.getToken();
    const url = `${this.baseUrl}/$metadata`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/xml",
      },
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return response.text();
  }

  /**
   * Query an entity with OData parameters
   */
  async queryEntity<T = Record<string, unknown>>(
    entityName: string,
    params: QueryParams = {}
  ): Promise<QueryResult<T>> {
    const queryString = this.buildQueryString(params);
    const path = `/${entityName}${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ODataResponse<T>>(path);

    return {
      records: response.value,
      count: response["@odata.count"],
      hasMore: !!response["@odata.nextLink"],
      nextLink: response["@odata.nextLink"],
    };
  }

  /**
   * Fetch a single record by key
   */
  async getRecord<T = Record<string, unknown>>(
    entityName: string,
    key: string | Record<string, string>,
    params: Pick<QueryParams, "$select" | "$expand"> = {}
  ): Promise<T> {
    const keyString = this.formatKey(key);
    const queryString = this.buildQueryString(params);
    const path = `/${entityName}(${keyString})${queryString ? `?${queryString}` : ""}`;

    return this.request<T>(path);
  }

  /**
   * Get count of records in an entity
   */
  async countRecords(entityName: string, filter?: string): Promise<number> {
    let path = `/${entityName}/$count`;
    if (filter) {
      path += `?$filter=${encodeURIComponent(filter)}`;
    }
    return this.request<number>(path);
  }

  /**
   * Fetch next page using @odata.nextLink
   */
  async fetchNextPage<T = Record<string, unknown>>(
    nextLink: string
  ): Promise<QueryResult<T>> {
    const response = await this.request<ODataResponse<T>>(nextLink);

    return {
      records: response.value,
      count: response["@odata.count"],
      hasMore: !!response["@odata.nextLink"],
      nextLink: response["@odata.nextLink"],
    };
  }

  /**
   * Build OData query string from parameters
   */
  private buildQueryString(params: QueryParams): string {
    const parts: string[] = [];

    if (params.$filter) {
      parts.push(`$filter=${encodeURIComponent(params.$filter)}`);
    }
    if (params.$select) {
      parts.push(`$select=${encodeURIComponent(params.$select)}`);
    }
    if (params.$expand) {
      parts.push(`$expand=${encodeURIComponent(params.$expand)}`);
    }
    if (params.$orderby) {
      parts.push(`$orderby=${encodeURIComponent(params.$orderby)}`);
    }
    if (params.$top !== undefined) {
      parts.push(`$top=${params.$top}`);
    }
    if (params.$skip !== undefined) {
      parts.push(`$skip=${params.$skip}`);
    }
    if (params.$count) {
      parts.push("$count=true");
    }
    if (params.$apply) {
      parts.push(`$apply=${encodeURIComponent(params.$apply)}`);
    }

    return parts.join("&");
  }

  /**
   * Escape single quotes in OData string values by doubling them
   * e.g., "O'Brien" -> "O''Brien"
   */
  private escapeODataString(value: string): string {
    return value.replace(/'/g, "''");
  }

  /**
   * Format key for OData request
   * Single key: 'value' -> 'value'
   * Compound key: { Field1: 'val1', Field2: 'val2' } -> "Field1='val1',Field2='val2'"
   * Note: Single quotes in values are escaped by doubling them
   */
  private formatKey(key: string | Record<string, string>): string {
    if (typeof key === "string") {
      // Check if it's already formatted (contains = or ,)
      if (key.includes("=") || key.includes(",")) {
        return key;
      }
      // Single key value - escape quotes and wrap
      return `'${this.escapeODataString(key)}'`;
    }

    // Compound key object - escape quotes in each value
    return Object.entries(key)
      .map(([field, value]) => `${field}='${this.escapeODataString(value)}'`)
      .join(",");
  }

  /**
   * Raw request method with retry, timeout, and correlation ID support.
   * Returns the full Response object for callers that need headers (e.g., ETag).
   * Used internally by CRUD operations.
   */
  private async requestRaw(
    path: string,
    options: RequestInit = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<Response> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const correlationId = generateCorrelationId();
    let lastError: Error | null = null;
    const requestStartTime = Date.now();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const token = await this.tokenManager.getToken();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "OData-MaxVersion": "4.0",
              "OData-Version": "4.0",
              "x-correlation-id": correlationId,
              ...options.headers,
            },
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            // Don't retry 412 (concurrency conflict) - it's a business logic error
            if (response.status === 412) {
              this.recordMetrics(requestStartTime, false);
              throw new D365Error(
                "Record was modified by another user. Refresh and try again.",
                412
              );
            }

            if (RETRYABLE_STATUS_CODES.includes(response.status) && attempt < MAX_RETRIES) {
              let retryDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
              const retryAfterHeader = response.headers.get("Retry-After");
              if (retryAfterHeader) {
                const retryAfterSeconds = parseInt(retryAfterHeader, 10);
                if (!isNaN(retryAfterSeconds)) {
                  retryDelay = retryAfterSeconds * 1000;
                }
              }
              log(`Request failed with status ${response.status}, retrying in ${retryDelay}ms (attempt ${attempt + 1}/${MAX_RETRIES}) [${correlationId}]`);
              await sleep(retryDelay);
              continue;
            }

            this.recordMetrics(requestStartTime, false);
            await this.handleErrorResponse(response);
          }

          this.recordMetrics(requestStartTime, true);
          return response;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          lastError = new D365Error(`Request timed out after ${timeoutMs}ms [${correlationId}]`, 0);
          if (attempt < MAX_RETRIES) {
            const retryDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
            log(`Request timed out [${correlationId}], retrying in ${retryDelay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await sleep(retryDelay);
            continue;
          }
        } else if (error instanceof D365Error) {
          error.message = `${error.message} [${correlationId}]`;
          throw error;
        } else {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < MAX_RETRIES) {
            const retryDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
            log(`Network error [${correlationId}], retrying in ${retryDelay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await sleep(retryDelay);
            continue;
          }
        }
      }
    }

    this.recordMetrics(requestStartTime, false);
    throw lastError || new D365Error(`Request failed after all retries [${correlationId}]`, 0);
  }

  /**
   * Create a new record in an entity (POST)
   * Returns the created record with server-generated fields
   */
  async createRecord<T = Record<string, unknown>>(
    entityName: string,
    data: Record<string, unknown>
  ): Promise<{ record: T; etag?: string }> {
    const path = `/${entityName}`;

    const response = await this.requestRaw(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(data),
    });

    const record = await response.json() as T;
    const etag = response.headers.get("ETag") || undefined;

    return { record, etag };
  }

  /**
   * Update an existing record (PATCH)
   * Supports optimistic concurrency with ETag
   * Returns the new ETag after update
   */
  async updateRecord(
    entityName: string,
    key: string | Record<string, string>,
    data: Record<string, unknown>,
    etag?: string
  ): Promise<{ etag?: string }> {
    const keyString = this.formatKey(key);
    const path = `/${entityName}(${keyString})`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (etag) {
      headers["If-Match"] = etag;
    }

    const response = await this.requestRaw(path, {
      method: "PATCH",
      headers,
      body: JSON.stringify(data),
    });

    const newEtag = response.headers.get("ETag") || undefined;
    return { etag: newEtag };
  }

  /**
   * Delete a record (DELETE)
   * Supports optimistic concurrency with ETag
   */
  async deleteRecord(
    entityName: string,
    key: string | Record<string, string>,
    etag?: string
  ): Promise<void> {
    const keyString = this.formatKey(key);
    const path = `/${entityName}(${keyString})`;

    const headers: Record<string, string> = {};

    if (etag) {
      headers["If-Match"] = etag;
    }

    await this.requestRaw(path, {
      method: "DELETE",
      headers,
    });
  }

  /**
   * Execute a batch request using OData $batch endpoint
   * Supports multiple operations in a single HTTP request
   */
  async batchRequest(
    operations: BatchOperation[]
  ): Promise<BatchResponse[]> {
    const boundary = `batch_${generateCorrelationId()}`;
    const body = buildBatchBody(operations, boundary);

    const response = await this.requestRaw("/$batch", {
      method: "POST",
      headers: {
        "Content-Type": `multipart/mixed; boundary=${boundary}`,
      },
      body,
    });

    const responseText = await response.text();
    const responseBoundary = extractBoundary(response.headers.get("Content-Type") || "");
    return parseBatchResponse(responseText, responseBoundary || boundary);
  }
}
