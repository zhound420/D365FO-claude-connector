/**
 * D365 API bindings for sandbox execution
 * Creates a wrapper around D365Client and MetadataCache for use in the sandbox
 */

import type { D365Client } from "../d365-client.js";
import type { MetadataCache } from "../metadata-cache.js";
import type { D365SandboxApi } from "./types.js";
import type { QueryParams, EntityDefinition, EnumDefinition } from "../types.js";

/**
 * Create D365 API bindings for sandbox use
 */
export function createD365Api(client: D365Client, metadataCache: MetadataCache): D365SandboxApi {
  return {
    async query(
      entity: string,
      options?: Pick<QueryParams, "$filter" | "$select" | "$expand" | "$orderby" | "$top" | "$skip">
    ): Promise<Record<string, unknown>[]> {
      const result = await client.queryEntity(entity, {
        ...options,
        $top: options?.$top ?? 100, // Default limit in sandbox
      });
      return result.records;
    },

    async get(
      entity: string,
      key: string | Record<string, string>,
      options?: Pick<QueryParams, "$select" | "$expand">
    ): Promise<Record<string, unknown>> {
      return client.getRecord(entity, key, options);
    },

    async count(entity: string, filter?: string): Promise<number> {
      return client.countRecords(entity, filter);
    },

    async describe(entity: string): Promise<EntityDefinition | null> {
      return metadataCache.getEntityDefinition(entity);
    },

    async getEnum(enumName: string): Promise<EnumDefinition | null> {
      return metadataCache.getEnumDefinition(enumName);
    },

    async odata(path: string): Promise<unknown> {
      // Ensure path starts with /
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      return client.request(normalizedPath);
    },
  };
}
