/**
 * Delete Record tool - deletes records from D365 entities (non-production only)
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnvironmentManager } from "../environment-manager.js";
import { WriteNotAllowedError } from "../environment-manager.js";
import { D365Error } from "../d365-client.js";
import { environmentSchema, formatEnvironmentHeader } from "./common.js";

/**
 * Register the delete_record tool
 */
export function registerDeleteRecordTool(
  server: McpServer,
  envManager: EnvironmentManager
): void {
  server.tool(
    "delete_record",
    `Delete a record from a D365 entity.

⚠️ WARNING: This permanently deletes the record. This action cannot be undone.

IMPORTANT: This tool only works on NON-PRODUCTION environments. Production environments are read-only.

Optionally provide an ETag for optimistic concurrency control (prevents deleting if the record was modified).

Key formats:
- Single key: key="US-001"
- Compound key: key={"DataAreaId": "usmf", "CustomerAccount": "US-001"}
- Pre-formatted: key="DataAreaId='usmf',CustomerAccount='US-001'"

Examples:
- Delete customer: entity="CustomersV3", key="US-001"
- Delete with compound key: entity="SalesOrderLines", key={"SalesOrderNumber": "SO-001", "LineNumber": 1}
- Delete with concurrency check: entity="CustomersV3", key="US-001", etag="W/\\"xxx\\""`,
    {
      entity: z.string().describe("Entity name containing the record to delete (e.g., 'CustomersV3')"),
      key: z.union([
        z.string(),
        z.record(z.string()),
      ]).describe("Record key - single value, compound key object, or pre-formatted string"),
      etag: z.string().optional().describe("ETag for optimistic concurrency control (prevents deleting modified records)"),
      environment: environmentSchema,
    },
    async ({ entity, key, etag, environment }) => {
      try {
        // Get environment config
        const envConfig = envManager.getEnvironmentConfig(environment);

        // Check write permissions - this will throw if production
        try {
          envManager.assertWriteAllowed(environment);
        } catch (error) {
          if (error instanceof WriteNotAllowedError) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ Write operation blocked\n\n${error.message}\n\nUse list_environments to see available non-production environments.`,
                },
              ],
              isError: true,
            };
          }
          throw error;
        }

        const client = envManager.getClient(environment);

        // Format key for display
        const keyDisplay = typeof key === "string" ? key : JSON.stringify(key);

        // Delete the record
        await client.deleteRecord(entity, key, etag);

        // Format output
        const lines: string[] = [];
        lines.push(formatEnvironmentHeader(envConfig.name, envConfig.displayName, false));
        lines.push("");
        lines.push(`✅ Record deleted successfully from ${entity}`);
        lines.push(`Key: ${keyDisplay}`);

        return {
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        let message: string;
        if (error instanceof D365Error) {
          message = `Failed to delete record: ${error.message}`;
          if (error.statusCode === 404) {
            message += "\n\nRecord not found. It may have already been deleted.";
          } else if (error.statusCode === 412) {
            message += "\n\nThe record was modified by another user since you last read it.";
            message += "\nFetch the record again to get the latest ETag and retry.";
          } else if (error.statusCode === 409) {
            message += "\n\nCannot delete this record due to referential integrity constraints.";
            message += "\nOther records may depend on this record.";
          }
        } else {
          message = `Error deleting record: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
