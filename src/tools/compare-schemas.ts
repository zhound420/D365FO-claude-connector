/**
 * Compare Schemas tool - detect schema drift between D365 environments
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnvironmentManager } from "../environment-manager.js";
import type { EntityDefinition, EntityField, NavigationProperty, EntityKey } from "../types.js";
import { formatToolError } from "./common.js";

/**
 * Diff result for a single field
 */
interface FieldDiff {
  field: string;
  status: "added" | "removed" | "changed";
  details?: string;
}

/**
 * Diff result for navigation properties
 */
interface NavPropDiff {
  name: string;
  status: "added" | "removed" | "changed";
  details?: string;
}

/**
 * Diff result for keys
 */
interface KeyDiff {
  name: string;
  status: "added" | "removed" | "changed";
  details?: string;
}

/**
 * Compare two entity definitions and return diffs
 */
function compareEntityDefinitions(
  envAName: string,
  envBName: string,
  defA: EntityDefinition,
  defB: EntityDefinition
): { fields: FieldDiff[]; navProps: NavPropDiff[]; keys: KeyDiff[] } {
  // Compare fields
  const fieldsA = new Map(defA.fields.map(f => [f.name, f]));
  const fieldsB = new Map(defB.fields.map(f => [f.name, f]));
  const fieldDiffs: FieldDiff[] = [];

  for (const [name, fieldA] of fieldsA) {
    const fieldB = fieldsB.get(name);
    if (!fieldB) {
      fieldDiffs.push({ field: name, status: "removed", details: `Only in ${envAName}` });
    } else {
      const changes = compareField(fieldA, fieldB);
      if (changes.length > 0) {
        fieldDiffs.push({ field: name, status: "changed", details: changes.join(", ") });
      }
    }
  }
  for (const name of fieldsB.keys()) {
    if (!fieldsA.has(name)) {
      fieldDiffs.push({ field: name, status: "added", details: `Only in ${envBName}` });
    }
  }

  // Compare navigation properties
  const navA = new Map(defA.navigationProperties.map(n => [n.name, n]));
  const navB = new Map(defB.navigationProperties.map(n => [n.name, n]));
  const navPropDiffs: NavPropDiff[] = [];

  for (const [name, npA] of navA) {
    const npB = navB.get(name);
    if (!npB) {
      navPropDiffs.push({ name, status: "removed", details: `Only in ${envAName}` });
    } else {
      const changes = compareNavProp(npA, npB);
      if (changes.length > 0) {
        navPropDiffs.push({ name, status: "changed", details: changes.join(", ") });
      }
    }
  }
  for (const name of navB.keys()) {
    if (!navA.has(name)) {
      navPropDiffs.push({ name, status: "added", details: `Only in ${envBName}` });
    }
  }

  // Compare keys
  const keysA = new Map(defA.keys.map(k => [k.name, k]));
  const keysB = new Map(defB.keys.map(k => [k.name, k]));
  const keyDiffs: KeyDiff[] = [];

  for (const [name, keyA] of keysA) {
    const keyB = keysB.get(name);
    if (!keyB) {
      keyDiffs.push({ name, status: "removed", details: `Only in ${envAName}` });
    } else {
      const changes = compareKey(keyA, keyB);
      if (changes.length > 0) {
        keyDiffs.push({ name, status: "changed", details: changes.join(", ") });
      }
    }
  }
  for (const name of keysB.keys()) {
    if (!keysA.has(name)) {
      keyDiffs.push({ name, status: "added", details: `Only in ${envBName}` });
    }
  }

  return { fields: fieldDiffs, navProps: navPropDiffs, keys: keyDiffs };
}

function compareField(a: EntityField, b: EntityField): string[] {
  const changes: string[] = [];
  if (a.type !== b.type) changes.push(`type: ${a.type} -> ${b.type}`);
  if (a.nullable !== b.nullable) changes.push(`nullable: ${a.nullable} -> ${b.nullable}`);
  if (a.maxLength !== b.maxLength) changes.push(`maxLength: ${a.maxLength} -> ${b.maxLength}`);
  if (a.isEnum !== b.isEnum) changes.push(`isEnum: ${a.isEnum} -> ${b.isEnum}`);
  return changes;
}

function compareNavProp(a: NavigationProperty, b: NavigationProperty): string[] {
  const changes: string[] = [];
  if (a.targetEntity !== b.targetEntity) changes.push(`target: ${a.targetEntity} -> ${b.targetEntity}`);
  if (a.isCollection !== b.isCollection) changes.push(`isCollection: ${a.isCollection} -> ${b.isCollection}`);
  return changes;
}

function compareKey(a: EntityKey, b: EntityKey): string[] {
  const aFields = a.fields.sort().join(",");
  const bFields = b.fields.sort().join(",");
  if (aFields !== bFields) {
    return [`fields: [${aFields}] -> [${bFields}]`];
  }
  return [];
}

/**
 * Format diff results for output
 */
function formatDiffResults(
  entity: string,
  envAName: string,
  envBName: string,
  diffs: { fields: FieldDiff[]; navProps: NavPropDiff[]; keys: KeyDiff[] }
): string {
  const lines: string[] = [];

  lines.push(`Schema Comparison: ${entity}`);
  lines.push(`${envAName} vs ${envBName}`);
  lines.push("");

  const totalDiffs = diffs.fields.length + diffs.navProps.length + diffs.keys.length;

  if (totalDiffs === 0) {
    lines.push("No differences found - schemas are identical.");
    return lines.join("\n");
  }

  lines.push(`Found ${totalDiffs} difference(s)`);
  lines.push("");

  if (diffs.fields.length > 0) {
    lines.push(`## Fields (${diffs.fields.length} differences)`);
    for (const diff of diffs.fields) {
      const icon = diff.status === "added" ? "+" : diff.status === "removed" ? "-" : "~";
      lines.push(`  ${icon} ${diff.field}: ${diff.details}`);
    }
    lines.push("");
  }

  if (diffs.keys.length > 0) {
    lines.push(`## Keys (${diffs.keys.length} differences)`);
    for (const diff of diffs.keys) {
      const icon = diff.status === "added" ? "+" : diff.status === "removed" ? "-" : "~";
      lines.push(`  ${icon} ${diff.name}: ${diff.details}`);
    }
    lines.push("");
  }

  if (diffs.navProps.length > 0) {
    lines.push(`## Navigation Properties (${diffs.navProps.length} differences)`);
    for (const diff of diffs.navProps) {
      const icon = diff.status === "added" ? "+" : diff.status === "removed" ? "-" : "~";
      lines.push(`  ${icon} ${diff.name}: ${diff.details}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * Register the compare_schemas tool
 */
export function registerCompareSchemasTool(server: McpServer, envManager: EnvironmentManager): void {
  server.tool(
    "compare_schemas",
    `Compare an entity's schema between two D365 environments to detect schema drift.

Compares fields, keys, and navigation properties between environments.
Useful for verifying UAT/production parity before deployments.

Examples:
- compare_schemas(entity="CustomersV3", environmentA="production", environmentB="uat")
- compare_schemas(entity="SalesOrderHeadersV2", environmentA="production", environmentB="dev")`,
    {
      entity: z.string().describe("Entity name to compare (e.g., 'CustomersV3')"),
      environmentA: z.string().describe("First environment name (e.g., 'production')"),
      environmentB: z.string().describe("Second environment name (e.g., 'uat')"),
    },
    async ({ entity, environmentA, environmentB }) => {
      try {
        // Get metadata caches for both environments
        const cacheA = envManager.getMetadataCache(environmentA);
        const cacheB = envManager.getMetadataCache(environmentB);
        const envConfigA = envManager.getEnvironmentConfig(environmentA);
        const envConfigB = envManager.getEnvironmentConfig(environmentB);

        // Fetch entity definitions from both environments
        const [defA, defB] = await Promise.all([
          cacheA.getEntityDefinition(entity),
          cacheB.getEntityDefinition(entity),
        ]);

        if (!defA && !defB) {
          return {
            content: [{ type: "text", text: `Entity '${entity}' not found in either environment.` }],
            isError: true,
          };
        }

        if (!defA) {
          return {
            content: [{
              type: "text",
              text: `Entity '${entity}' exists only in ${envConfigB.displayName} (${environmentB}), not in ${envConfigA.displayName} (${environmentA}).`,
            }],
          };
        }

        if (!defB) {
          return {
            content: [{
              type: "text",
              text: `Entity '${entity}' exists only in ${envConfigA.displayName} (${environmentA}), not in ${envConfigB.displayName} (${environmentB}).`,
            }],
          };
        }

        // Compare the definitions
        const diffs = compareEntityDefinitions(
          envConfigA.displayName,
          envConfigB.displayName,
          defA,
          defB
        );

        const output = formatDiffResults(
          entity,
          `${envConfigA.displayName} (${environmentA})`,
          `${envConfigB.displayName} (${environmentB})`,
          diffs
        );

        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error, "Schema comparison error") }],
          isError: true,
        };
      }
    }
  );
}
