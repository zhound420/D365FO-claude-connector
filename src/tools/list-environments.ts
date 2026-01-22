/**
 * List Environments tool - shows all configured D365 environments
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnvironmentManager } from "../environment-manager.js";

/**
 * Register the list_environments tool
 */
export function registerListEnvironmentsTool(
  server: McpServer,
  envManager: EnvironmentManager
): void {
  server.tool(
    "list_environments",
    `List all configured D365 environments with their connection status and write permissions.

Shows:
- Environment name and display name
- Environment type (production or non-production)
- Write permissions (read-only for production, read/write for non-production)
- Default environment indicator
- Environment URL

Use this to understand which environments are available before targeting specific ones with the 'environment' parameter.`,
    {},
    async () => {
      try {
        const environments = envManager.getEnvironments();
        const defaultEnv = envManager.getDefaultEnvironmentName();

        const lines: string[] = [];
        lines.push(`Configured D365 Environments (${environments.length}):`);
        lines.push("");

        for (const env of environments) {
          const isDefault = env.name === defaultEnv;
          const writeStatus = env.type === "production" ? "read-only" : "read/write";
          const defaultMarker = isDefault ? " [DEFAULT]" : "";
          const typeIcon = env.type === "production" ? "🔒" : "✏️";

          lines.push(`${typeIcon} ${env.displayName} (${env.name})${defaultMarker}`);
          lines.push(`   Type: ${env.type}`);
          lines.push(`   Permissions: ${writeStatus}`);
          lines.push(`   URL: ${env.environmentUrl}`);
          lines.push("");
        }

        lines.push("---");
        lines.push("Usage: Add 'environment: \"<name>\"' parameter to any tool to target a specific environment.");
        lines.push("");
        lines.push("Write operations (create_record, update_record, delete_record) are only available");
        lines.push("on non-production environments. Production environments are always read-only.");

        return {
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing environments: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
