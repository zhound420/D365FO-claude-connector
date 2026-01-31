/**
 * Set Environment Tool
 *
 * Allows users to set a "working environment" for the conversation.
 * Once set, subsequent queries will use this environment by default
 * unless explicitly overridden with the 'environment' parameter.
 *
 * This tool is designed to work with Claude's conversation context -
 * Claude will remember the working environment for the duration of the
 * conversation and apply it to subsequent D365 queries.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EnvironmentManager } from "../environment-manager.js";

export function registerSetEnvironmentTool(
  server: McpServer,
  envManager: EnvironmentManager
): void {
  server.tool(
    "set_environment",
    "Set the working D365 environment for this conversation. " +
      "Once set, subsequent queries will use this environment by default " +
      "unless explicitly overridden with the 'environment' parameter. " +
      "Use list_environments to see available environments.",
    {
      environment: z
        .string()
        .describe(
          "Environment name to use (e.g., 'uat', 'production', 'dev'). " +
            "Use list_environments to see available options."
        ),
    },
    async ({ environment }) => {
      try {
        const envConfig = envManager.getEnvironmentConfig(environment);
        const emoji = envConfig.type === "production" ? "🔴" : "🟢";
        const writeStatus =
          envConfig.type === "production" ? "read-only" : "read/write";

        const lines = [
          `${emoji} **Working environment set to: ${envConfig.displayName}** (${environment})`,
          "",
          `**Type:** ${envConfig.type} [${writeStatus}]`,
          `**URL:** ${envConfig.environmentUrl}`,
          "",
          "All subsequent D365 queries will target this environment unless you specify otherwise.",
        ];

        if (envConfig.type === "production") {
          lines.push(
            "",
            "⚠️ Note: This is a production environment. Write operations (create, update, delete) are disabled."
          );
        }

        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        const available = envManager
          .getEnvironments()
          .map((e) => `  - ${e.name} (${e.displayName})`)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Environment "${environment}" not found.\n\n` +
                `**Available environments:**\n${available}\n\n` +
                `Use one of the environment names listed above.`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
