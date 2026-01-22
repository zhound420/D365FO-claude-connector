/**
 * Metrics module for D365 Environment Dashboard
 * Exports all metrics-related types and utilities
 */

// Types
export type {
  ApiCallStats,
  ConnectionHealth,
  OperationLogEntry,
  EnvironmentMetrics,
  DashboardData,
} from "./types.js";

export {
  createEmptyApiCallStats,
  createUnknownHealth,
} from "./types.js";

// Circular buffer and operation log
export { CircularBuffer, OperationLog } from "./operation-log.js";

// Singleton instances
export { MetricsTracker } from "./metrics-tracker.js";
export { HealthChecker } from "./health-checker.js";
