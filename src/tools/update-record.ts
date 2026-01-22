/**
 * Update Record tool - updates existing records in D365 entities (non-production only)
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnvironmentManager } from "../environment-manager.js";
import { WriteNotAllowedError } from "../environment-manager.js";
import { D365Error } from "../d365-client.js";
import { environmentSchema, formatEnvironmentHeader } from "./common.js";

/**
 * Register the update_record tool
 */
export function registerUpdateRecordTool(
  server: McpServer,
  envManager: EnvironmentManager
): void {
  server.tool(
    "update_record",
    `Update an existing record in a D365 entity.

IMPORTANT: This tool only works on NON-PRODUCTION environments. Production environments are read-only.

Supports partial updates - only fields in the data object will be modified.
Optionally provide an ETag for optimistic concurrency control (prevents overwriting changes made by others).

Key formats:
- Single key: key="US-001"
- Compound key: key={"DataAreaId": "usmf", "CustomerAccount": "US-001"}
- Pre-formatted: key="DataAreaId='usmf',CustomerAccount='US-001'"

Examples:
- Update customer name: entity="CustomersV3", key="US-001", data={"CustomerName": "New Name"}
- Update with compound key: entity="SalesOrderLines", key={"SalesOrderNumber": "SO-001", "LineNumber": 1}, data={"Quantity": 20}
- Update with concurrency check: entity="CustomersV3", key="US-001", data={"CustomerName": "New Name"}, etag="W/\\"xxx\\""

Returns the new ETag after update for subsequent operations.`,
    {
      entity: z.string().describe("Entity name containing the record (e.g., 'CustomersV3')"),
      key: z.union([
        z.string(),
        z.record(z.string()),
      ]).describe("Record key - single value, compound key object, or pre-formatted string"),
      data: z.record(z.unknown()).describe("Object containing field values to update (partial update supported)"),
      etag: z.string().optional().describe("ETag for optimistic concurrency control (prevents conflicting updates)"),
      environment: environmentSchema,
    },
    async ({ entity, key, data, etag, environment }) => {
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

        // Update the record
        const result = await client.updateRecord(entity, key, data, etag);

        // Format output
        const lines: string[] = [];
        lines.push(formatEnvironmentHeader(envConfig.name, envConfig.displayName, false));
        lines.push("");
        lines.push(`✅ Record updated successfully in ${entity}`);
        lines.push(`Key: ${keyDisplay}`);
        lines.push("");

        if (result.etag) {
          lines.push(`New ETag: ${result.etag}`);
          lines.push("(Save this ETag for subsequent updates)");
          lines.push("");
        }

        lines.push("Updated fields:");
        lines.push(JSON.stringify(data, null, 2));

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
          message = `Failed to update record: ${error.message}`;
          if (error.statusCode === 404) {
            message += "\n\nRecord not found. Verify the entity name and key values are correct.";
          } else if (error.statusCode === 400) {
            message += "\n\nTip: Check that field values are valid for their types.";
            message += "\nUse describe_entity to see the entity schema.";
          } else if (error.statusCode === 412) {
            message += "\n\nThe record was modified by another user since you last read it.";
            message += "\nFetch the record again to get the latest ETag and retry.";
          }
        } else {
          message = `Error updating record: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
