/**
 * Batch CRUD tool - execute multiple create/update/delete operations via OData $batch
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnvironmentManager } from "../environment-manager.js";
import { D365Error, type BatchOperation } from "../d365-client.js";
import { environmentSchema, formatEnvironmentHeader, formatToolError } from "./common.js";
import { WriteNotAllowedError } from "../environment-manager.js";

/**
 * Maximum operations per batch request
 */
const MAX_BATCH_OPERATIONS = 100;

/**
 * Schema for a single CRUD operation
 */
const CrudOperationSchema = z.object({
  method: z.enum(["POST", "PATCH", "DELETE"]).describe(
    "HTTP method: POST (create), PATCH (update), DELETE (delete)"
  ),
  entity: z.string().describe("Entity name (e.g., 'CustomersV3')"),
  key: z.string().optional().describe(
    "Record key for PATCH/DELETE operations (e.g., \"'US-001'\" or \"DataAreaId='usmf',CustomerAccount='US-001'\")"
  ),
  data: z.record(z.unknown()).optional().describe(
    "Record data for POST/PATCH operations"
  ),
  etag: z.string().optional().describe(
    "ETag for optimistic concurrency on PATCH/DELETE"
  ),
});

type CrudOperation = z.infer<typeof CrudOperationSchema>;

/**
 * Build the OData path for a CRUD operation
 */
function buildOperationPath(op: CrudOperation): string {
  if (op.method === "POST") {
    return `/${op.entity}`;
  }
  if (!op.key) {
    throw new Error(`Key is required for ${op.method} operations on ${op.entity}`);
  }
  return `/${op.entity}(${op.key})`;
}

/**
 * Convert our schema operations to BatchOperation format
 */
function toBatchOperations(operations: CrudOperation[]): BatchOperation[] {
  return operations.map(op => {
    const headers: Record<string, string> = {};
    if (op.etag) {
      headers["If-Match"] = op.etag;
    }
    if (op.method === "POST") {
      headers["Prefer"] = "return=representation";
    }

    return {
      method: op.method,
      path: buildOperationPath(op),
      data: op.data,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    };
  });
}

/**
 * Register the batch_crud tool
 */
export function registerBatchCrudTool(server: McpServer, envManager: EnvironmentManager): void {
  server.tool(
    "batch_crud",
    `Execute multiple create/update/delete operations in a single batch request.
Uses OData $batch for efficiency - all operations are sent in one HTTP request.

IMPORTANT: Only available on non-production environments.

Examples:
- Create multiple records:
  operations: [
    { method: "POST", entity: "CustomersV3", data: { CustomerAccount: "NEW-001", CustomerName: "New Customer" } },
    { method: "POST", entity: "CustomersV3", data: { CustomerAccount: "NEW-002", CustomerName: "Another Customer" } }
  ]
- Mixed operations:
  operations: [
    { method: "POST", entity: "CustomersV3", data: { CustomerAccount: "NEW-001" } },
    { method: "PATCH", entity: "CustomersV3", key: "'US-001'", data: { CustomerName: "Updated Name" } },
    { method: "DELETE", entity: "CustomersV3", key: "'OLD-001'" }
  ]`,
    {
      operations: z.array(CrudOperationSchema).min(1).max(MAX_BATCH_OPERATIONS).describe(
        `Array of CRUD operations (1-${MAX_BATCH_OPERATIONS})`
      ),
      environment: environmentSchema,
    },
    async ({ operations, environment }) => {
      try {
        // Enforce write guard
        envManager.assertWriteAllowed(environment);

        const client = envManager.getClient(environment);
        const envConfig = envManager.getEnvironmentConfig(environment);

        // Validate operations
        for (let i = 0; i < operations.length; i++) {
          const op = operations[i];
          if ((op.method === "PATCH" || op.method === "DELETE") && !op.key) {
            return {
              content: [{ type: "text", text: `Error: Operation ${i} (${op.method} ${op.entity}) requires a key` }],
              isError: true,
            };
          }
          if ((op.method === "POST" || op.method === "PATCH") && !op.data) {
            return {
              content: [{ type: "text", text: `Error: Operation ${i} (${op.method} ${op.entity}) requires data` }],
              isError: true,
            };
          }
        }

        // Execute batch
        const batchOps = toBatchOperations(operations);
        const responses = await client.batchRequest(batchOps);

        // Format results
        const lines: string[] = [];
        lines.push(formatEnvironmentHeader(envConfig.name, envConfig.displayName, false));
        lines.push("");

        let successCount = 0;
        let failCount = 0;

        lines.push(`Batch CRUD Results (${operations.length} operations)`);
        lines.push("");

        for (let i = 0; i < operations.length; i++) {
          const op = operations[i];
          const response = responses[i];
          const label = `${op.method} ${op.entity}${op.key ? `(${op.key})` : ""}`;

          if (response && response.status >= 200 && response.status < 300) {
            successCount++;
            lines.push(`[${i + 1}] ${label} - ${response.status} OK`);
            if (response.body && op.method === "POST") {
              lines.push(`    Created: ${JSON.stringify(response.body)}`);
            }
          } else if (response) {
            failCount++;
            const errorBody = response.body && typeof response.body === "object"
              ? JSON.stringify(response.body)
              : String(response.body || response.statusText);
            lines.push(`[${i + 1}] ${label} - ${response.status} FAILED: ${errorBody}`);
          } else {
            failCount++;
            lines.push(`[${i + 1}] ${label} - No response received`);
          }
        }

        lines.push("");
        lines.push(`Summary: ${successCount} succeeded, ${failCount} failed`);

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          isError: failCount > 0,
        };
      } catch (error) {
        if (error instanceof WriteNotAllowedError) {
          return {
            content: [{ type: "text", text: error.message }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: formatToolError(error, "Batch CRUD error") }],
          isError: true,
        };
      }
    }
  );
}
