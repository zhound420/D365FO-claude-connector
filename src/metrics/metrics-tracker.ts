/**
 * In-memory metrics tracker for D365 environments
 * Singleton that tracks API call statistics and operation logs
 */

import type { ApiCallStats, OperationLogEntry } from "./types.js";
import { createEmptyApiCallStats } from "./types.js";
import { OperationLog } from "./operation-log.js";

/**
 * Default maximum number of operations to keep per environment
 */
const DEFAULT_MAX_OPERATIONS = 50;

/**
 * Singleton metrics tracker for all D365 environments
 */
class MetricsTrackerImpl {
  private apiStats: Map<string, ApiCallStats> = new Map();
  private operationLogs: Map<string, OperationLog> = new Map();
  private readonly serverStartTime: Date = new Date();

  /**
   * Record an API call for an environment
   */
  recordApiCall(envName: string, latencyMs: number, success: boolean): void {
    const stats = this.getOrCreateStats(envName);
    stats.totalCalls++;
    stats.totalLatencyMs += latencyMs;
    stats.lastCallTime = new Date();

    if (success) {
      stats.successfulCalls++;
    } else {
      stats.failedCalls++;
    }
  }

  /**
   * Record an operation (tool invocation) for an environment
   */
  recordOperation(envName: string, entry: OperationLogEntry): void {
    const log = this.getOrCreateOperationLog(envName);
    log.log(entry);
  }

  /**
   * Get API call statistics for an environment
   */
  getStats(envName: string): ApiCallStats {
    return this.apiStats.get(envName) || createEmptyApiCallStats();
  }

  /**
   * Get recent operations for an environment
   */
  getRecentOperations(envName: string, limit: number = 10): OperationLogEntry[] {
    const log = this.operationLogs.get(envName);
    return log ? log.getRecent(limit) : [];
  }

  /**
   * Get all operations for an environment
   */
  getAllOperations(envName: string): OperationLogEntry[] {
    const log = this.operationLogs.get(envName);
    return log ? log.getAll() : [];
  }

  /**
   * Get server uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.serverStartTime.getTime();
  }

  /**
   * Get server start time
   */
  getServerStartTime(): Date {
    return this.serverStartTime;
  }

  /**
   * Get all environment names that have metrics
   */
  getTrackedEnvironments(): string[] {
    const envNames = new Set<string>();
    for (const name of this.apiStats.keys()) {
      envNames.add(name);
    }
    for (const name of this.operationLogs.keys()) {
      envNames.add(name);
    }
    return Array.from(envNames);
  }

  /**
   * Calculate average latency for an environment
   */
  getAverageLatency(envName: string): number | undefined {
    const stats = this.apiStats.get(envName);
    if (!stats || stats.totalCalls === 0) {
      return undefined;
    }
    return Math.round(stats.totalLatencyMs / stats.totalCalls);
  }

  /**
   * Calculate success rate for an environment
   */
  getSuccessRate(envName: string): number | undefined {
    const stats = this.apiStats.get(envName);
    if (!stats || stats.totalCalls === 0) {
      return undefined;
    }
    return (stats.successfulCalls / stats.totalCalls) * 100;
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.apiStats.clear();
    this.operationLogs.clear();
  }

  /**
   * Reset metrics for a specific environment
   */
  resetEnvironment(envName: string): void {
    this.apiStats.delete(envName);
    this.operationLogs.delete(envName);
  }

  /**
   * Get or create API stats for an environment
   */
  private getOrCreateStats(envName: string): ApiCallStats {
    let stats = this.apiStats.get(envName);
    if (!stats) {
      stats = createEmptyApiCallStats();
      this.apiStats.set(envName, stats);
    }
    return stats;
  }

  /**
   * Get or create operation log for an environment
   */
  private getOrCreateOperationLog(envName: string): OperationLog {
    let log = this.operationLogs.get(envName);
    if (!log) {
      log = new OperationLog(DEFAULT_MAX_OPERATIONS);
      this.operationLogs.set(envName, log);
    }
    return log;
  }
}

/**
 * Singleton instance of the metrics tracker
 */
export const MetricsTracker = new MetricsTrackerImpl();
