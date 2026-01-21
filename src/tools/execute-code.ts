/**
 * Execute code tool - sandboxed JavaScript execution with D365 API access
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { D365Client } from "../d365-client.js";
import type { MetadataCache } from "../metadata-cache.js";
import { SandboxManager } from "../sandbox/index.js";

/**
 * Register the execute_code tool
 */
export function registerExecuteCodeTool(
  server: McpServer,
  client: D365Client,
  metadataCache: MetadataCache
): void {
  server.tool(
    "execute_code",
    `Execute JavaScript code in a secure sandbox with D365 API access.

Available APIs in the sandbox:
- d365.query(entity, options?) - Query records with OData options ($filter, $select, $expand, $orderby, $top, $skip)
- d365.get(entity, key, options?) - Get single record by key
- d365.count(entity, filter?) - Count records with optional filter
- d365.describe(entity) - Get entity schema definition
- d365.getEnum(enumName) - Get enum definition with values
- d365.odata(path) - Execute raw OData path

The code runs in an isolated environment with:
- 128MB memory limit
- 30 second timeout
- No file system or network access (except D365 API)
- console.log/warn/error captured in output

Example code:
\`\`\`javascript
// Count customers and get top 5
const count = await d365.count('CustomersV3');
const customers = await d365.query('CustomersV3', { $top: 5, $select: 'CustomerAccount,CustomerName' });
return { count, customers };
\`\`\``,
    {
      code: z.string().describe("JavaScript code to execute. Use 'return' to return a value. The d365 API is available for D365 operations."),
      description: z.string().optional().describe("Optional description of what the code does"),
    },
    async ({ code, description }) => {
      const sandbox = new SandboxManager(client, metadataCache);

      try {
        const result = await sandbox.execute(code);

        const lines: string[] = [];

        // Description if provided
        if (description) {
          lines.push(`Task: ${description}`);
          lines.push("");
        }

        // Execution info
        lines.push(`Execution time: ${result.executionTime}ms`);
        lines.push("");

        // Console logs
        if (result.logs.length > 0) {
          lines.push("Console output:");
          for (const log of result.logs) {
            lines.push(`  ${log}`);
          }
          lines.push("");
        }

        // Result
        lines.push("Result:");
        if (result.value === undefined) {
          lines.push("  (no return value)");
        } else {
          const formatted = typeof result.value === "object"
            ? JSON.stringify(result.value, null, 2)
            : String(result.value);
          lines.push(formatted);
        }

        return {
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        const err = error as { message?: string; logs?: string[]; executionTime?: number; isTimeout?: boolean; isMemoryLimit?: boolean };

        const lines: string[] = [];

        if (description) {
          lines.push(`Task: ${description}`);
          lines.push("");
        }

        // Error type
        if (err.isTimeout) {
          lines.push("Error: Execution timeout (30 second limit exceeded)");
        } else if (err.isMemoryLimit) {
          lines.push("Error: Memory limit exceeded (128MB limit)");
        } else {
          lines.push(`Error: ${err.message || String(error)}`);
        }

        // Execution time if available
        if (err.executionTime !== undefined) {
          lines.push(`Execution time: ${err.executionTime}ms`);
        }

        // Console logs if any
        if (err.logs && err.logs.length > 0) {
          lines.push("");
          lines.push("Console output before error:");
          for (const log of err.logs) {
            lines.push(`  ${log}`);
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          isError: true,
        };
      }
    }
  );
}
