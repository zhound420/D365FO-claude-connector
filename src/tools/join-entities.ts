/**
 * Join Entities tool - cross-entity joins using $expand or client-side join
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import type { EnvironmentManager } from "../environment-manager.js";
import { D365Client, D365Error } from "../d365-client.js";
import type { ODataResponse, NavigationProperty, EntityDefinition } from "../types.js";
import { ProgressReporter } from "../progress.js";
import { environmentSchema, formatEnvironmentHeader } from "./common.js";

/**
 * Default max records for join operations
 */
const DEFAULT_MAX_RECORDS = 5000;

/**
 * Threshold for using optimized IN filter on secondary entity
 */
const IN_FILTER_THRESHOLD = 100;

/**
 * Entity source configuration
 */
const entitySourceSchema = z.object({
  entity: z.string().describe("Entity name (e.g., 'SalesOrderHeadersV2')"),
  key: z.string().describe("Join key field name (e.g., 'SalesOrderNumber')"),
  filter: z.string().optional().describe("OData $filter expression"),
  select: z.array(z.string()).optional().describe("Fields to include in results"),
});

type EntitySource = z.infer<typeof entitySourceSchema>;

/**
 * Join strategy type
 */
type JoinStrategy = "auto" | "expand" | "client";

/**
 * Join type
 */
type JoinType = "inner" | "left";

/**
 * Join result metadata
 */
interface JoinResult {
  records: Record<string, unknown>[];
  strategy: "expand" | "client";
  primaryCount: number;
  secondaryCount: number;
  joinedCount: number;
  elapsedMs: number;
  truncated: boolean;
}

/**
 * Check if primary entity has a navigation property pointing to secondary entity
 */
function findNavigationProperty(
  primaryDef: EntityDefinition,
  secondaryEntityName: string
): NavigationProperty | null {
  // Look for navigation property that targets the secondary entity
  const navProp = primaryDef.navigationProperties.find(
    (np) => np.targetEntity.toLowerCase() === secondaryEntityName.toLowerCase()
  );
  return navProp || null;
}

/**
 * Build OData query path with parameters
 */
function buildQueryPath(
  entity: string,
  options: {
    select?: string[];
    filter?: string;
    expand?: string;
    top?: number;
    count?: boolean;
  }
): string {
  const params: string[] = [];

  if (options.select && options.select.length > 0) {
    params.push(`$select=${encodeURIComponent(options.select.join(","))}`);
  }
  if (options.filter) {
    params.push(`$filter=${encodeURIComponent(options.filter)}`);
  }
  if (options.expand) {
    params.push(`$expand=${encodeURIComponent(options.expand)}`);
  }
  if (options.top !== undefined) {
    params.push(`$top=${options.top}`);
  }
  if (options.count) {
    params.push("$count=true");
  }

  const queryString = params.length > 0 ? `?${params.join("&")}` : "";
  return `/${entity}${queryString}`;
}

/**
 * Execute paginated fetch of records
 */
async function fetchWithPagination(
  client: D365Client,
  initialPath: string,
  maxRecords: number,
  progress?: ProgressReporter,
  label?: string
): Promise<{
  records: Record<string, unknown>[];
  totalCount?: number;
  truncated: boolean;
}> {
  const allRecords: Record<string, unknown>[] = [];
  let pagesFetched = 0;
  let totalCount: number | undefined;
  let truncated = false;

  // Ensure $count=true is in the path
  let currentPath = initialPath;
  if (!currentPath.includes("$count=true")) {
    currentPath += currentPath.includes("?") ? "&$count=true" : "?$count=true";
  }

  let nextLink: string | undefined = currentPath;

  while (nextLink) {
    const response: ODataResponse<Record<string, unknown>> = await client.request(nextLink);
    pagesFetched++;

    // Capture total count from first response
    if (pagesFetched === 1 && response["@odata.count"] !== undefined) {
      totalCount = response["@odata.count"];
    }

    if (response.value && Array.isArray(response.value)) {
      allRecords.push(...response.value);
    }

    // Report progress
    if (progress && pagesFetched > 1) {
      const totalInfo = totalCount !== undefined ? ` of ${totalCount.toLocaleString()}` : "";
      const labelPrefix = label ? `${label}: ` : "";
      await progress.report(`${labelPrefix}Fetching page ${pagesFetched}... (${allRecords.length.toLocaleString()}${totalInfo} records)`);
    }

    // Check if we've hit the max records limit
    if (allRecords.length >= maxRecords) {
      truncated = true;
      break;
    }

    nextLink = response["@odata.nextLink"];
  }

  return {
    records: allRecords.slice(0, maxRecords),
    totalCount,
    truncated,
  };
}

/**
 * Execute join using OData $expand (server-side join)
 */
async function executeExpandStrategy(
  client: D365Client,
  primary: EntitySource,
  secondary: EntitySource,
  navProp: NavigationProperty,
  joinType: JoinType,
  maxRecords: number,
  flatten: boolean,
  progress: ProgressReporter
): Promise<JoinResult> {
  const startTime = Date.now();

  // Build $expand clause with nested options
  let expandClause = navProp.name;
  const nestedOptions: string[] = [];

  if (secondary.select && secondary.select.length > 0) {
    nestedOptions.push(`$select=${secondary.select.join(",")}`);
  }
  if (secondary.filter) {
    nestedOptions.push(`$filter=${secondary.filter}`);
  }

  if (nestedOptions.length > 0) {
    expandClause = `${navProp.name}(${nestedOptions.join(";")})`;
  }

  // Build primary query with $expand
  const path = buildQueryPath(primary.entity, {
    select: primary.select,
    filter: primary.filter,
    expand: expandClause,
    count: true,
  });

  await progress.report("Executing server-side join with $expand...");

  // Fetch with pagination
  const result = await fetchWithPagination(client, path, maxRecords, progress, "Primary");

  // Process results - flatten the expanded records
  const joinedRecords: Record<string, unknown>[] = [];
  let primaryCount = 0;
  let secondaryCount = 0;

  for (const primaryRecord of result.records) {
    primaryCount++;
    const expandedData = primaryRecord[navProp.name];

    // Handle the expanded data (could be array or single object)
    const secondaryRecords = Array.isArray(expandedData)
      ? expandedData as Record<string, unknown>[]
      : expandedData ? [expandedData as Record<string, unknown>] : [];

    if (secondaryRecords.length === 0) {
      // Left join: include primary with null secondary fields
      if (joinType === "left") {
        const flatRecord: Record<string, unknown> = {};

        // Copy primary fields (exclude the navigation property)
        for (const [key, value] of Object.entries(primaryRecord)) {
          if (key !== navProp.name && !key.startsWith("@odata")) {
            flatRecord[key] = value;
          }
        }

        joinedRecords.push(flatRecord);
      }
      // Inner join: skip if no secondary records
    } else {
      // Create a joined record for each secondary record (handles one-to-many)
      for (const secondaryRecord of secondaryRecords) {
        secondaryCount++;
        const flatRecord: Record<string, unknown> = {};

        // Copy primary fields (exclude the navigation property)
        for (const [key, value] of Object.entries(primaryRecord)) {
          if (key !== navProp.name && !key.startsWith("@odata")) {
            flatRecord[key] = value;
          }
        }

        // Copy secondary fields with prefix if flattening
        for (const [key, value] of Object.entries(secondaryRecord)) {
          if (!key.startsWith("@odata")) {
            const fieldName = flatten ? `_${key}` : key;
            flatRecord[fieldName] = value;
          }
        }

        joinedRecords.push(flatRecord);

        // Check if we've exceeded max records
        if (joinedRecords.length >= maxRecords) {
          break;
        }
      }
    }

    if (joinedRecords.length >= maxRecords) {
      break;
    }
  }

  return {
    records: joinedRecords,
    strategy: "expand",
    primaryCount,
    secondaryCount,
    joinedCount: joinedRecords.length,
    elapsedMs: Date.now() - startTime,
    truncated: result.truncated || joinedRecords.length >= maxRecords,
  };
}

/**
 * Execute client-side join (fetch both datasets, join in memory)
 */
async function executeClientSideJoin(
  client: D365Client,
  primary: EntitySource,
  secondary: EntitySource,
  joinType: JoinType,
  maxRecords: number,
  flatten: boolean,
  progress: ProgressReporter
): Promise<JoinResult> {
  const startTime = Date.now();

  // Ensure join keys are included in select lists
  const primarySelect = primary.select
    ? [...new Set([...primary.select, primary.key])]
    : undefined;

  const secondarySelect = secondary.select
    ? [...new Set([...secondary.select, secondary.key])]
    : undefined;

  // Fetch primary records
  await progress.report("Fetching primary records...");
  const primaryPath = buildQueryPath(primary.entity, {
    select: primarySelect,
    filter: primary.filter,
    count: true,
  });

  const primaryResult = await fetchWithPagination(client, primaryPath, maxRecords, progress, "Primary");

  if (primaryResult.records.length === 0) {
    return {
      records: [],
      strategy: "client",
      primaryCount: 0,
      secondaryCount: 0,
      joinedCount: 0,
      elapsedMs: Date.now() - startTime,
      truncated: false,
    };
  }

  // Build optimized filter for secondary if we have few primary keys
  let secondaryFilter = secondary.filter;
  const primaryKeys = primaryResult.records
    .map((r) => r[primary.key])
    .filter((k) => k != null);

  if (primaryKeys.length <= IN_FILTER_THRESHOLD && primaryKeys.length > 0) {
    // Build IN filter for secondary
    const inValues = primaryKeys
      .map((k) => typeof k === "string" ? `'${k}'` : String(k))
      .join(",");
    const inFilter = `${secondary.key} in (${inValues})`;

    secondaryFilter = secondary.filter
      ? `(${secondary.filter}) and (${inFilter})`
      : inFilter;
  }

  // Fetch secondary records
  await progress.report("Fetching secondary records...");
  const secondaryPath = buildQueryPath(secondary.entity, {
    select: secondarySelect,
    filter: secondaryFilter,
    count: true,
  });

  const secondaryResult = await fetchWithPagination(client, secondaryPath, maxRecords * 10, progress, "Secondary");

  // Build lookup map from secondary records (supports one-to-many)
  await progress.report("Performing join...");
  const secondaryMap = new Map<unknown, Record<string, unknown>[]>();

  for (const record of secondaryResult.records) {
    const keyValue = record[secondary.key];
    if (keyValue == null) continue;

    const existing = secondaryMap.get(keyValue) || [];
    existing.push(record);
    secondaryMap.set(keyValue, existing);
  }

  // Perform the join
  const joinedRecords: Record<string, unknown>[] = [];

  for (const primaryRecord of primaryResult.records) {
    const primaryKeyValue = primaryRecord[primary.key];

    if (primaryKeyValue == null) continue;

    const matchingSecondary = secondaryMap.get(primaryKeyValue) || [];

    if (matchingSecondary.length === 0) {
      // Left join: include primary with no secondary
      if (joinType === "left") {
        const flatRecord: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(primaryRecord)) {
          if (!key.startsWith("@odata")) {
            flatRecord[key] = value;
          }
        }

        joinedRecords.push(flatRecord);
      }
      // Inner join: skip
    } else {
      // Create joined record for each matching secondary (handles one-to-many)
      for (const secondaryRecord of matchingSecondary) {
        const flatRecord: Record<string, unknown> = {};

        // Copy primary fields
        for (const [key, value] of Object.entries(primaryRecord)) {
          if (!key.startsWith("@odata")) {
            flatRecord[key] = value;
          }
        }

        // Copy secondary fields with prefix
        for (const [key, value] of Object.entries(secondaryRecord)) {
          if (!key.startsWith("@odata")) {
            // Avoid duplicating the join key if it's the same field name
            if (key === secondary.key && key === primary.key) {
              continue;
            }
            const fieldName = flatten ? `_${key}` : key;
            flatRecord[fieldName] = value;
          }
        }

        joinedRecords.push(flatRecord);

        if (joinedRecords.length >= maxRecords) {
          break;
        }
      }
    }

    if (joinedRecords.length >= maxRecords) {
      break;
    }
  }

  return {
    records: joinedRecords,
    strategy: "client",
    primaryCount: primaryResult.records.length,
    secondaryCount: secondaryResult.records.length,
    joinedCount: joinedRecords.length,
    elapsedMs: Date.now() - startTime,
    truncated: joinedRecords.length >= maxRecords,
  };
}

/**
 * Format join result for output
 */
function formatJoinResult(
  primary: EntitySource,
  secondary: EntitySource,
  result: JoinResult,
  envHeader?: string
): string {
  const lines: string[] = [];

  // Environment header
  if (envHeader) {
    lines.push(envHeader);
    lines.push("");
  }

  // Header
  lines.push(`Join Results: ${primary.entity} + ${secondary.entity}`);
  lines.push(`Strategy: ${result.strategy === "expand" ? "$expand (server-side)" : "client-side"}`);
  lines.push(`Join: ${primary.key} = ${secondary.key}`);

  // Stats
  let statsLine = `Records: ${result.joinedCount.toLocaleString()} joined`;
  statsLine += ` from ${result.primaryCount.toLocaleString()} primary`;
  if (result.secondaryCount > 0) {
    statsLine += `, ${result.secondaryCount.toLocaleString()} secondary`;
  }
  if (result.elapsedMs >= 2000) {
    statsLine += ` (${(result.elapsedMs / 1000).toFixed(1)}s)`;
  }
  if (result.truncated) {
    statsLine += " [truncated]";
  }
  lines.push(statsLine);

  lines.push("");

  // Records
  if (result.records.length === 0) {
    lines.push("(no matching records found)");
  } else {
    lines.push(JSON.stringify(result.records, null, 2));
  }

  return lines.join("\n");
}

/**
 * List available navigation properties for an entity
 */
function formatAvailableNavProps(entityDef: EntityDefinition): string {
  if (entityDef.navigationProperties.length === 0) {
    return "  (no navigation properties defined)";
  }

  return entityDef.navigationProperties
    .map((np) => `  - ${np.name} → ${np.targetEntity}${np.isCollection ? " (collection)" : ""}`)
    .join("\n");
}

/**
 * List available fields for an entity definition
 */
function formatAvailableFields(entityDef: EntityDefinition): string {
  const fieldNames = entityDef.fields.map((f) => f.name);
  if (fieldNames.length === 0) {
    return "(unable to determine available fields)";
  }
  // Show first 20 fields
  const display = fieldNames.slice(0, 20);
  if (fieldNames.length > 20) {
    display.push(`... and ${fieldNames.length - 20} more`);
  }
  return display.join(", ");
}

/**
 * Register the join_entities tool
 */
export function registerJoinEntitiesTool(
  server: McpServer,
  envManager: EnvironmentManager
): void {
  server.tool(
    "join_entities",
    `Join data from two D365 entities using either OData $expand (server-side) or client-side join.

The tool automatically detects if a navigation property exists between entities and uses
$expand for optimal performance. Falls back to client-side join when no relationship exists.

Examples:
- Join orders with lines: primary={entity: "SalesOrderHeadersV2", key: "SalesOrderNumber"}, secondary={entity: "SalesOrderLines", key: "SalesOrderNumber"}
- With filters: primary={..., filter: "OrderStatus eq 'Open'"}, secondary={..., filter: "LineAmount gt 1000"}
- Left join: joinType="left" to include primary records without matches
- Force client-side: strategy="client" to skip navigation property detection`,
    {
      primary: entitySourceSchema.describe("Primary (left) entity configuration"),
      secondary: entitySourceSchema.describe("Secondary (right) entity configuration"),
      joinType: z.enum(["inner", "left"]).optional().default("inner").describe(
        "Join type: 'inner' returns only matches, 'left' includes all primary records (default: inner)"
      ),
      flatten: z.boolean().optional().default(true).describe(
        "Prefix secondary fields with '_' to avoid collisions (default: true)"
      ),
      maxRecords: z.number().optional().default(DEFAULT_MAX_RECORDS).describe(
        `Maximum records in result (default: ${DEFAULT_MAX_RECORDS})`
      ),
      strategy: z.enum(["auto", "expand", "client"]).optional().default("auto").describe(
        "Join strategy: 'auto' detects best approach, 'expand' forces $expand, 'client' forces client-side (default: auto)"
      ),
      environment: environmentSchema,
    },
    async ({ primary, secondary, joinType, flatten, maxRecords, strategy, environment }, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const client = envManager.getClient(environment);
      const metadataCache = envManager.getMetadataCache(environment);
      const envConfig = envManager.getEnvironmentConfig(environment);

      try {
        const progress = new ProgressReporter(server, "join_entities", extra.sessionId);

        // Validate primary entity exists
        await progress.report("Validating entities...");
        const primaryDef = await metadataCache.getEntityDefinition(primary.entity);
        if (!primaryDef) {
          const exists = await metadataCache.entityExists(primary.entity);
          if (!exists) {
            return {
              content: [{
                type: "text",
                text: `Primary entity '${primary.entity}' not found. Use the d365://entities resource to list available entities.`,
              }],
              isError: true,
            };
          }
          // Entity exists but we couldn't get definition - proceed with caution
        }

        // Validate secondary entity exists
        const secondaryDef = await metadataCache.getEntityDefinition(secondary.entity);
        if (!secondaryDef) {
          const exists = await metadataCache.entityExists(secondary.entity);
          if (!exists) {
            return {
              content: [{
                type: "text",
                text: `Secondary entity '${secondary.entity}' not found. Use the d365://entities resource to list available entities.`,
              }],
              isError: true,
            };
          }
        }

        // Check for navigation property if we have entity definition
        let navProp: NavigationProperty | null = null;
        if (primaryDef) {
          navProp = findNavigationProperty(primaryDef, secondary.entity);
        }

        // Determine strategy
        let useExpand = false;
        if (strategy === "expand") {
          if (!navProp) {
            const navPropsInfo = primaryDef
              ? formatAvailableNavProps(primaryDef)
              : "(entity definition not available)";
            return {
              content: [{
                type: "text",
                text: `Cannot use $expand strategy: no navigation property from '${primary.entity}' to '${secondary.entity}'.\n\nAvailable navigation properties on ${primary.entity}:\n${navPropsInfo}\n\nUse strategy="client" for client-side join, or strategy="auto" to let the tool decide.`,
              }],
              isError: true,
            };
          }
          useExpand = true;
        } else if (strategy === "auto") {
          useExpand = navProp !== null;
        }
        // strategy === "client" keeps useExpand = false

        // Validate join keys exist in entity definitions if available
        if (primaryDef && primaryDef.fields.length > 0) {
          const primaryKeyExists = primaryDef.fields.some(
            (f) => f.name.toLowerCase() === primary.key.toLowerCase()
          );
          if (!primaryKeyExists) {
            return {
              content: [{
                type: "text",
                text: `Join key '${primary.key}' not found in primary entity '${primary.entity}'.\n\nAvailable fields: ${formatAvailableFields(primaryDef)}`,
              }],
              isError: true,
            };
          }
        }

        if (secondaryDef && secondaryDef.fields.length > 0) {
          const secondaryKeyExists = secondaryDef.fields.some(
            (f) => f.name.toLowerCase() === secondary.key.toLowerCase()
          );
          if (!secondaryKeyExists) {
            return {
              content: [{
                type: "text",
                text: `Join key '${secondary.key}' not found in secondary entity '${secondary.entity}'.\n\nAvailable fields: ${formatAvailableFields(secondaryDef)}`,
              }],
              isError: true,
            };
          }
        }

        // Execute join
        let result: JoinResult;

        if (useExpand && navProp) {
          result = await executeExpandStrategy(
            client,
            primary,
            secondary,
            navProp,
            joinType,
            maxRecords,
            flatten,
            progress
          );
        } else {
          result = await executeClientSideJoin(
            client,
            primary,
            secondary,
            joinType,
            maxRecords,
            flatten,
            progress
          );
        }

        // Format and return result
        const envHeader = formatEnvironmentHeader(envConfig.name, envConfig.displayName, envConfig.type === "production");
        const output = formatJoinResult(primary, secondary, result, envHeader);

        return {
          content: [{
            type: "text",
            text: output,
          }],
        };
      } catch (error) {
        let message: string;

        if (error instanceof D365Error) {
          message = error.message;
          if (error.statusCode === 404) {
            message = `Entity or resource not found. Verify the entity names are correct.\n\nError: ${error.message}`;
          } else if (error.statusCode === 400) {
            message = `Invalid request. Check your filter expressions and field names.\n\nError: ${error.message}`;
          }
        } else {
          message = `Error executing join: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
