/**
 * Create Record tool - creates new records in D365 entities (non-production only)
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnvironmentManager } from "../environment-manager.js";
import { WriteNotAllowedError } from "../environment-manager.js";
import { D365Error } from "../d365-client.js";
import { environmentSchema, formatEnvironmentHeader } from "./common.js";

/**
 * Register the create_record tool
 */
export function registerCreateRecordTool(
  server: McpServer,
  envManager: EnvironmentManager
): void {
  server.tool(
    "create_record",
    `Create a new record in a D365 entity.

IMPORTANT: This tool only works on NON-PRODUCTION environments. Production environments are read-only.

The data object should contain field values matching the entity schema. Use describe_entity to see available fields.
Server-generated fields (like RecId, timestamps) will be set automatically.

Examples:
- Create customer: entity="CustomersV3", data={"CustomerAccount": "CUST-001", "CustomerName": "Contoso Ltd"}
- Create sales order line: entity="SalesOrderLines", data={"SalesOrderNumber": "SO-001", "ItemNumber": "ITEM-001", "Quantity": 10}

Returns the created record with all server-generated fields and the ETag for subsequent updates.`,
    {
      entity: z.string().describe("Entity name to create record in (e.g., 'CustomersV3')"),
      data: z.record(z.unknown()).describe("Object containing field values for the new record"),
      environment: environmentSchema,
    },
    async ({ entity, data, environment }) => {
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

        // Create the record
        const { record, etag } = await client.createRecord(entity, data);

        // Format output
        const lines: string[] = [];
        lines.push(formatEnvironmentHeader(envConfig.name, envConfig.displayName, false));
        lines.push("");
        lines.push(`✅ Record created successfully in ${entity}`);
        lines.push("");

        if (etag) {
          lines.push(`ETag: ${etag}`);
          lines.push("(Save this ETag if you plan to update or delete this record)");
          lines.push("");
        }

        lines.push("Created Record:");
        lines.push(JSON.stringify(record, null, 2));

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
          message = `Failed to create record: ${error.message}`;
          if (error.statusCode === 400) {
            message += "\n\nTip: Check that all required fields are provided and have valid values.";
            message += "\nUse describe_entity to see the entity schema.";
          } else if (error.statusCode === 409) {
            message += "\n\nA record with this key already exists.";
          }
        } else {
          message = `Error creating record: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
