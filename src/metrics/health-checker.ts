/**
 * Health checker for D365 environment connections
 * Performs lightweight health checks with caching to prevent excessive API calls
 */

import type { ConnectionHealth } from "./types.js";
import type { D365Client } from "../d365-client.js";

/**
 * Cache TTL for health check results (60 seconds)
 */
const CACHE_TTL_MS = 60000;

/**
 * Health check timeout (5 seconds)
 */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Latency threshold for degraded status (2 seconds)
 */
const DEGRADED_LATENCY_THRESHOLD_MS = 2000;

interface CachedHealth {
  health: ConnectionHealth;
  checkedAt: Date;
}

/**
 * Singleton health checker with caching
 */
class HealthCheckerImpl {
  private cache: Map<string, CachedHealth> = new Map();

  /**
   * Check the health of a D365 environment connection
   * Returns cached result if available and not expired
   */
  async checkHealth(client: D365Client, envName: string): Promise<ConnectionHealth> {
    // Check cache first
    const cached = this.cache.get(envName);
    if (cached && this.isCacheValid(cached)) {
      return cached.health;
    }

    // Perform health check
    const health = await this.performHealthCheck(client);

    // Cache the result
    this.cache.set(envName, {
      health,
      checkedAt: new Date(),
    });

    return health;
  }

  /**
   * Get cached health without performing a new check
   * Returns unknown status if no cached data
   */
  getCachedHealth(envName: string): ConnectionHealth {
    const cached = this.cache.get(envName);
    if (cached) {
      return cached.health;
    }
    return {
      status: "unknown",
      lastChecked: undefined,
      latencyMs: undefined,
      errorMessage: undefined,
    };
  }

  /**
   * Force a health check, bypassing the cache
   */
  async forceCheck(client: D365Client, envName: string): Promise<ConnectionHealth> {
    const health = await this.performHealthCheck(client);
    this.cache.set(envName, {
      health,
      checkedAt: new Date(),
    });
    return health;
  }

  /**
   * Clear cached health for an environment
   */
  clearCache(envName?: string): void {
    if (envName) {
      this.cache.delete(envName);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Check if a cached health result is still valid
   */
  private isCacheValid(cached: CachedHealth): boolean {
    return Date.now() - cached.checkedAt.getTime() < CACHE_TTL_MS;
  }

  /**
   * Perform the actual health check
   * Uses a lightweight query: GET /SystemUsers?$top=1&$select=SystemUserId
   */
  private async performHealthCheck(client: D365Client): Promise<ConnectionHealth> {
    const startTime = Date.now();

    try {
      // Lightweight health check - fetch just one system user ID
      await client.request(
        "/SystemUsers?$top=1&$select=SystemUserId",
        {},
        HEALTH_CHECK_TIMEOUT_MS
      );

      const latencyMs = Date.now() - startTime;

      return {
        status: latencyMs > DEGRADED_LATENCY_THRESHOLD_MS ? "degraded" : "healthy",
        lastChecked: new Date(),
        latencyMs,
        errorMessage: undefined,
      };
    } catch (error) {
      return {
        status: "unreachable",
        lastChecked: new Date(),
        latencyMs: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Singleton instance of the health checker
 */
export const HealthChecker = new HealthCheckerImpl();
