/**
 * Type definitions for the sandbox execution environment
 */

import type { QueryParams, EntityDefinition, EnumDefinition } from "../types.js";

/**
 * Configuration for sandbox execution
 */
export interface SandboxConfig {
  /** Memory limit in MB (default: 128) */
  memoryLimit?: number;
  /** Execution timeout in ms (default: 30000) */
  timeout?: number;
}

/**
 * Result of sandbox code execution
 */
export interface SandboxResult {
  /** The returned value from the executed code */
  value: unknown;
  /** Console logs captured during execution */
  logs: string[];
  /** Execution time in milliseconds */
  executionTime: number;
}

/**
 * Error from sandbox execution
 */
export interface SandboxError {
  /** Error message */
  message: string;
  /** Stack trace if available */
  stack?: string;
  /** Whether this was a timeout */
  isTimeout?: boolean;
  /** Whether this was a memory limit error */
  isMemoryLimit?: boolean;
}

/**
 * D365 API interface available in the sandbox
 */
export interface D365SandboxApi {
  /**
   * Query records from an entity
   * @param entity Entity name
   * @param options OData query options
   */
  query(
    entity: string,
    options?: Pick<QueryParams, "$filter" | "$select" | "$expand" | "$orderby" | "$top" | "$skip">
  ): Promise<Record<string, unknown>[]>;

  /**
   * Get a single record by key
   * @param entity Entity name
   * @param key Record key (single value or compound key object)
   * @param options Optional select/expand
   */
  get(
    entity: string,
    key: string | Record<string, string>,
    options?: Pick<QueryParams, "$select" | "$expand">
  ): Promise<Record<string, unknown>>;

  /**
   * Count records in an entity
   * @param entity Entity name
   * @param filter Optional filter expression
   */
  count(entity: string, filter?: string): Promise<number>;

  /**
   * Get entity schema definition
   * @param entity Entity name
   */
  describe(entity: string): Promise<EntityDefinition | null>;

  /**
   * Get enum definition
   * @param enumName Enum name
   */
  getEnum(enumName: string): Promise<EnumDefinition | null>;

  /**
   * Execute raw OData path
   * @param path OData path (appended to /data/)
   */
  odata(path: string): Promise<unknown>;
}

/**
 * Default sandbox configuration
 */
export const DEFAULT_SANDBOX_CONFIG: Required<SandboxConfig> = {
  memoryLimit: 128,
  timeout: 30000,
};
