/**
 * Metrics data structures for D365 Environment Dashboard
 */

/**
 * API call statistics for an environment
 */
export interface ApiCallStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalLatencyMs: number;
  lastCallTime?: Date;
}

/**
 * Connection health status for an environment
 */
export interface ConnectionHealth {
  status: "healthy" | "degraded" | "unreachable" | "unknown";
  lastChecked?: Date;
  latencyMs?: number;
  errorMessage?: string;
}

/**
 * Log entry for a single operation
 */
export interface OperationLogEntry {
  timestamp: Date;
  operation: string;  // tool name
  entity?: string;
  recordCount?: number;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}

/**
 * Aggregated metrics for a single environment
 */
export interface EnvironmentMetrics {
  name: string;
  displayName: string;
  type: "production" | "non-production";
  environmentUrl: string;
  isDefault: boolean;
  health: ConnectionHealth;
  apiStats: ApiCallStats;
  recentOperations: OperationLogEntry[];
}

/**
 * Complete dashboard data structure
 */
export interface DashboardData {
  generatedAt: Date;
  environments: EnvironmentMetrics[];
  serverVersion: string;
  serverUptime: number;  // milliseconds
}

/**
 * Create empty API call stats
 */
export function createEmptyApiCallStats(): ApiCallStats {
  return {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    totalLatencyMs: 0,
    lastCallTime: undefined,
  };
}

/**
 * Create unknown connection health status
 */
export function createUnknownHealth(): ConnectionHealth {
  return {
    status: "unknown",
    lastChecked: undefined,
    latencyMs: undefined,
    errorMessage: undefined,
  };
}
