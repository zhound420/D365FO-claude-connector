/**
 * Dashboard tool - comprehensive environment status display
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnvironmentManager } from "../environment-manager.js";
import type {
  DashboardData,
  EnvironmentMetrics,
  ConnectionHealth,
  ApiCallStats,
  OperationLogEntry,
} from "../metrics/index.js";

/**
 * Format a number with thousands separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format relative time (e.g., "2 min ago")
 */
function formatRelativeTime(date: Date | undefined): string {
  if (!date) {
    return "Never";
  }

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  return date.toLocaleDateString();
}

/**
 * Format time as HH:MM
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Get health status indicator
 */
function getHealthIndicator(health: ConnectionHealth): string {
  switch (health.status) {
    case "healthy":
      return "●";
    case "degraded":
      return "◐";
    case "unreachable":
      return "○";
    case "unknown":
    default:
      return "○";
  }
}

/**
 * Get health status text
 */
function getHealthText(health: ConnectionHealth): string {
  switch (health.status) {
    case "healthy":
      return `Healthy (${health.latencyMs}ms)`;
    case "degraded":
      return `Degraded (${health.latencyMs}ms)`;
    case "unreachable":
      return "Unreachable";
    case "unknown":
    default:
      return "Unknown";
  }
}

/**
 * Format API stats line
 */
function formatApiStats(stats: ApiCallStats): string {
  if (stats.totalCalls === 0) {
    return "No activity";
  }

  const successRate = ((stats.successfulCalls / stats.totalCalls) * 100).toFixed(1);
  return `${formatNumber(stats.totalCalls)} total | ${formatNumber(stats.successfulCalls)} success | ${formatNumber(stats.failedCalls)} failed (${successRate}%)`;
}

/**
 * Format average latency
 */
function formatAvgLatency(stats: ApiCallStats): string {
  if (stats.totalCalls === 0) {
    return "N/A";
  }
  const avgMs = Math.round(stats.totalLatencyMs / stats.totalCalls);
  return `${avgMs}ms`;
}

/**
 * Format operation log entry
 */
function formatOperation(entry: OperationLogEntry): string {
  const time = formatTime(entry.timestamp);
  const status = entry.success ? "✓" : "✗";
  const operation = entry.operation.padEnd(18);
  const entity = (entry.entity || "").padEnd(20);

  let result: string;
  if (!entry.success) {
    result = entry.errorMessage?.substring(0, 15) || "error";
  } else if (entry.recordCount !== undefined) {
    result = `${entry.recordCount} record${entry.recordCount !== 1 ? "s" : ""}`;
  } else {
    result = "done";
  }

  return `  ${time} ${status} ${operation} ${entity} ${result}`;
}

/**
 * Generate ASCII dashboard header
 */
function generateHeader(data: DashboardData): string[] {
  const dateStr = data.generatedAt.toISOString().replace("T", " ").substring(0, 19);
  const uptimeStr = formatDuration(data.serverUptime);

  return [
    "╔══════════════════════════════════════════════════════════════════╗",
    "║                    D365 ENVIRONMENT DASHBOARD                     ║",
    `║                    Generated: ${dateStr.padEnd(19)}          ║`,
    "╠══════════════════════════════════════════════════════════════════╣",
    `║ Server: v${data.serverVersion.padEnd(7)} | Uptime: ${uptimeStr.padEnd(40)}║`,
    "╚══════════════════════════════════════════════════════════════════╝",
    "",
  ];
}

/**
 * Generate ASCII box for an environment
 */
function generateEnvironmentBox(metrics: EnvironmentMetrics): string[] {
  const lines: string[] = [];

  // Type icon and header
  const typeIcon = metrics.type === "production" ? "🔒" : "✏️";
  const defaultMarker = metrics.isDefault ? " (Default)" : "";
  const headerText = `${typeIcon} ${metrics.displayName}${defaultMarker}`;

  // Top border
  lines.push("┌─────────────────────────────────────────────────────────────────┐");
  lines.push(`│ ${headerText.padEnd(63)} │`);
  lines.push(`│    ${metrics.environmentUrl.substring(0, 60).padEnd(60)} │`);
  lines.push("├─────────────────────────────────────────────────────────────────┤");

  // Health status
  const healthIndicator = getHealthIndicator(metrics.health);
  const healthText = getHealthText(metrics.health);
  const lastCheck = formatRelativeTime(metrics.health.lastChecked);
  lines.push(`│ Health: ${healthIndicator} ${healthText.padEnd(24)} Last Check: ${lastCheck.padEnd(14)} │`);

  // API stats
  const apiStatsText = formatApiStats(metrics.apiStats);
  if (metrics.apiStats.totalCalls > 0) {
    lines.push(`│ API Calls: ${apiStatsText.padEnd(53)} │`);

    const avgLatency = formatAvgLatency(metrics.apiStats);
    const lastCall = formatRelativeTime(metrics.apiStats.lastCallTime);
    lines.push(`│ Avg Latency: ${avgLatency.padEnd(22)} Last Call: ${lastCall.padEnd(18)} │`);
  } else {
    lines.push(`│ API Calls: ${apiStatsText.padEnd(53)} │`);
  }

  // Recent operations
  if (metrics.recentOperations.length > 0) {
    lines.push("├─────────────────────────────────────────────────────────────────┤");
    lines.push("│ Recent Operations:                                              │");

    const opsToShow = metrics.recentOperations.slice(0, 5);
    for (const op of opsToShow) {
      const opLine = formatOperation(op);
      lines.push(`│${opLine.padEnd(65)}│`);
    }
  }

  // Bottom border
  lines.push("└─────────────────────────────────────────────────────────────────┘");
  lines.push("");

  return lines;
}

/**
 * Generate complete ASCII dashboard
 */
function generateAsciiDashboard(data: DashboardData): string {
  const lines: string[] = [];

  // Header
  lines.push(...generateHeader(data));

  // Environment boxes
  for (const env of data.environments) {
    lines.push(...generateEnvironmentBox(env));
  }

  return lines.join("\n");
}

/**
 * Register the dashboard tool
 */
export function registerDashboardTool(
  server: McpServer,
  envManager: EnvironmentManager
): void {
  server.tool(
    "dashboard",
    `Display a comprehensive dashboard of all D365 environments.

Shows for each environment:
- Connection health status with latency
- API call statistics (total, success, failed, success rate)
- Average response latency
- Recent operations with timestamps and results

The dashboard performs lightweight health checks with 60-second caching
to prevent excessive API calls.

Use this tool to:
- Monitor environment health and connectivity
- Review API usage patterns
- Track recent operations and their success rates
- Diagnose connection issues`,
    {},
    async () => {
      try {
        // Get dashboard data with health checks
        const data = await envManager.getDashboardData(true);

        // Generate ASCII dashboard
        const dashboard = generateAsciiDashboard(data);

        return {
          content: [
            {
              type: "text",
              text: dashboard,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error generating dashboard: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
