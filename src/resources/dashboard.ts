/**
 * Dashboard resource for D365 environment metrics
 * Returns JSON data at d365://dashboard
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnvironmentManager } from "../environment-manager.js";

/**
 * Register the dashboard resource
 */
export function registerDashboardResource(
  server: McpServer,
  envManager: EnvironmentManager
): void {
  server.resource(
    "d365-dashboard",
    "d365://dashboard",
    {
      description:
        "Get comprehensive dashboard data for all D365 environments in JSON format. " +
        "Includes connection health, API statistics, and recent operations for each environment.",
      mimeType: "application/json",
    },
    async (uri) => {
      // Get dashboard data with health checks
      const data = await envManager.getDashboardData(true);

      // Serialize with proper date handling
      const jsonResult = {
        generatedAt: data.generatedAt.toISOString(),
        serverVersion: data.serverVersion,
        serverUptimeMs: data.serverUptime,
        serverUptimeFormatted: formatUptime(data.serverUptime),
        environments: data.environments.map((env) => ({
          name: env.name,
          displayName: env.displayName,
          type: env.type,
          environmentUrl: env.environmentUrl,
          isDefault: env.isDefault,
          health: {
            status: env.health.status,
            lastChecked: env.health.lastChecked?.toISOString() || null,
            latencyMs: env.health.latencyMs || null,
            errorMessage: env.health.errorMessage || null,
          },
          apiStats: {
            totalCalls: env.apiStats.totalCalls,
            successfulCalls: env.apiStats.successfulCalls,
            failedCalls: env.apiStats.failedCalls,
            successRate:
              env.apiStats.totalCalls > 0
                ? ((env.apiStats.successfulCalls / env.apiStats.totalCalls) * 100).toFixed(2)
                : null,
            averageLatencyMs:
              env.apiStats.totalCalls > 0
                ? Math.round(env.apiStats.totalLatencyMs / env.apiStats.totalCalls)
                : null,
            lastCallTime: env.apiStats.lastCallTime?.toISOString() || null,
          },
          recentOperations: env.recentOperations.map((op) => ({
            timestamp: op.timestamp.toISOString(),
            operation: op.operation,
            entity: op.entity || null,
            recordCount: op.recordCount ?? null,
            durationMs: op.durationMs,
            success: op.success,
            errorMessage: op.errorMessage || null,
          })),
        })),
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(jsonResult, null, 2),
          },
        ],
      };
    }
  );
}

/**
 * Format uptime in human-readable form
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
