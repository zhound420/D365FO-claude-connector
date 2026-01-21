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
 * D365 OData API Client
 */
export class D365Client {
  private config: D365Config;
  private tokenManager: TokenManager;
  private baseUrl: string;

  constructor(config: D365Config) {
    this.config = config;
    this.tokenManager = new TokenManager(config);
    this.baseUrl = `${config.environmentUrl}/data`;
  }

  /**
   * Make an authenticated request to the D365 OData API
   */
  async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.tokenManager.getToken();

    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        ...options.headers,
      },
    });

    // Handle error responses
    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

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
   * Format key for OData request
   * Single key: 'value' -> 'value'
   * Compound key: { Field1: 'val1', Field2: 'val2' } -> "Field1='val1',Field2='val2'"
   */
  private formatKey(key: string | Record<string, string>): string {
    if (typeof key === "string") {
      // Check if it's already formatted (contains = or ,)
      if (key.includes("=") || key.includes(",")) {
        return key;
      }
      // Single key value - quote it
      return `'${key}'`;
    }

    // Compound key object
    return Object.entries(key)
      .map(([field, value]) => `${field}='${value}'`)
      .join(",");
  }
}
