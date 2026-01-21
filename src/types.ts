/**
 * D365 Finance & Operations MCP Server Type Definitions
 */

/**
 * Configuration for D365 connection
 */
export interface D365Config {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  environmentUrl: string;
}

/**
 * OAuth2 token response from Azure AD
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  resource: string;
}

/**
 * Cached token with expiration tracking
 */
export interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Generic OData response wrapper
 */
export interface ODataResponse<T = unknown> {
  "@odata.context"?: string;
  "@odata.count"?: number;
  "@odata.nextLink"?: string;
  value: T[];
}

/**
 * Single OData entity response
 */
export interface ODataEntityResponse<T = unknown> {
  "@odata.context"?: string;
  "@odata.etag"?: string;
  [key: string]: T | string | undefined;
}

/**
 * Entity field definition from metadata
 */
export interface EntityField {
  name: string;
  type: string;
  nullable: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
  isEnum: boolean;
  enumTypeName?: string;
  description?: string;
}

/**
 * Entity key field
 */
export interface EntityKey {
  name: string;
  fields: string[];
}

/**
 * Navigation property definition
 */
export interface NavigationProperty {
  name: string;
  type: string;
  isCollection: boolean;
  targetEntity: string;
}

/**
 * Complete entity definition
 */
export interface EntityDefinition {
  name: string;
  description?: string;
  isCustom: boolean;
  fields: EntityField[];
  keys: EntityKey[];
  navigationProperties: NavigationProperty[];
}

/**
 * Lightweight entity summary for listing
 */
export interface EntitySummary {
  name: string;
  description?: string;
  isCustom: boolean;
}

/**
 * Enum member definition
 */
export interface EnumMember {
  name: string;
  value: number;
}

/**
 * Enum type definition
 */
export interface EnumDefinition {
  name: string;
  fullName: string;
  members: EnumMember[];
}

/**
 * Query parameters for OData queries
 */
export interface QueryParams {
  $filter?: string;
  $select?: string;
  $expand?: string;
  $orderby?: string;
  $top?: number;
  $skip?: number;
  $count?: boolean;
}

/**
 * Query result with pagination info
 */
export interface QueryResult<T = Record<string, unknown>> {
  records: T[];
  count?: number;
  hasMore: boolean;
  nextLink?: string;
}

/**
 * D365 OData error response
 */
export interface ODataError {
  error: {
    code: string;
    message: string;
    innererror?: {
      message: string;
      type: string;
      stacktrace: string;
    };
  };
}

/**
 * Metadata cache entry
 */
export interface MetadataCacheEntry {
  entities: Map<string, EntitySummary>;
  entityDetails: Map<string, EntityDefinition>;
  enums: Map<string, EnumDefinition>;
  fetchedAt: number;
  rawMetadata?: string;
}

/**
 * Transport mode for MCP server
 */
export type TransportMode = "stdio" | "http";
