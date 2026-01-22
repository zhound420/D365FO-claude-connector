/**
 * Environment Manager for D365 MCP Server
 * Manages multiple D365Client instances and enforces write guards
 */

import type { EnvironmentConfig, EnvironmentsConfig } from "./types.js";
import { D365Client } from "./d365-client.js";
import { MetadataCache } from "./metadata-cache.js";
import {
  loadEnvironmentsConfig,
  getDefaultEnvironment,
  getEnvironmentByName,
  toD365Config,
} from "./config-loader.js";
import { log } from "./config.js";

/**
 * Custom error for write operation violations
 */
export class WriteNotAllowedError extends Error {
  constructor(environmentName: string) {
    super(
      `Write operations are not allowed on production environment "${environmentName}". ` +
      `Only non-production environments (type: "non-production") support create, update, and delete operations.`
    );
    this.name = "WriteNotAllowedError";
  }
}

/**
 * Custom error for unknown environment
 */
export class UnknownEnvironmentError extends Error {
  constructor(environmentName: string, availableEnvironments: string[]) {
    super(
      `Environment "${environmentName}" not found. ` +
      `Available environments: ${availableEnvironments.join(", ")}`
    );
    this.name = "UnknownEnvironmentError";
  }
}

/**
 * Manages multiple D365 environments with separate clients and metadata caches
 */
export class EnvironmentManager {
  private config: EnvironmentsConfig;
  private clients: Map<string, D365Client> = new Map();
  private metadataCaches: Map<string, MetadataCache> = new Map();
  private defaultEnvironment: EnvironmentConfig;

  constructor() {
    this.config = loadEnvironmentsConfig();
    this.defaultEnvironment = getDefaultEnvironment(this.config);
    log(`Loaded ${this.config.environments.length} environment(s), default: ${this.defaultEnvironment.name}`);
  }

  /**
   * Get all configured environments
   */
  getEnvironments(): EnvironmentConfig[] {
    return this.config.environments;
  }

  /**
   * Get environment configuration by name
   */
  getEnvironmentConfig(name?: string): EnvironmentConfig {
    if (!name) {
      return this.defaultEnvironment;
    }

    const env = getEnvironmentByName(this.config, name);
    if (!env) {
      throw new UnknownEnvironmentError(
        name,
        this.config.environments.map(e => e.name)
      );
    }
    return env;
  }

  /**
   * Get or create a D365Client for the specified environment
   */
  getClient(environmentName?: string): D365Client {
    const env = this.getEnvironmentConfig(environmentName);

    if (!this.clients.has(env.name)) {
      log(`Creating client for environment: ${env.name} (${env.displayName})`);
      const client = new D365Client(toD365Config(env));
      this.clients.set(env.name, client);
    }

    return this.clients.get(env.name)!;
  }

  /**
   * Get or create a MetadataCache for the specified environment
   */
  getMetadataCache(environmentName?: string): MetadataCache {
    const env = this.getEnvironmentConfig(environmentName);
    const client = this.getClient(environmentName);

    if (!this.metadataCaches.has(env.name)) {
      log(`Creating metadata cache for environment: ${env.name}`);
      const cache = new MetadataCache(client);
      this.metadataCaches.set(env.name, cache);
    }

    return this.metadataCaches.get(env.name)!;
  }

  /**
   * Get the default environment name
   */
  getDefaultEnvironmentName(): string {
    return this.defaultEnvironment.name;
  }

  /**
   * Check if an environment is production
   */
  isProduction(environmentName?: string): boolean {
    const env = this.getEnvironmentConfig(environmentName);
    return env.type === "production";
  }

  /**
   * Check if write operations are allowed on an environment
   */
  isWriteAllowed(environmentName?: string): boolean {
    const env = this.getEnvironmentConfig(environmentName);
    return env.type === "non-production";
  }

  /**
   * Assert that write operations are allowed, throw if not
   * Call this before any create/update/delete operation
   */
  assertWriteAllowed(environmentName?: string): void {
    const env = this.getEnvironmentConfig(environmentName);
    if (env.type === "production") {
      throw new WriteNotAllowedError(env.name);
    }
  }

  /**
   * Get environment summary for display
   */
  getEnvironmentSummary(environmentName?: string): string {
    const env = this.getEnvironmentConfig(environmentName);
    const writeStatus = env.type === "production" ? "read-only" : "read/write";
    return `${env.displayName} (${env.name}) - ${env.type} [${writeStatus}]`;
  }

  /**
   * List all environments with their status
   */
  listEnvironmentsSummary(): string[] {
    return this.config.environments.map(env => {
      const isDefault = env.default ? " [default]" : "";
      const writeStatus = env.type === "production" ? "read-only" : "read/write";
      return `${env.displayName} (${env.name}) - ${env.type} [${writeStatus}]${isDefault}`;
    });
  }

  /**
   * Verify connectivity for an environment
   */
  async verifyConnectivity(environmentName?: string): Promise<boolean> {
    try {
      const client = this.getClient(environmentName);
      await client.fetchEntityList();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify connectivity for all environments
   */
  async verifyAllConnectivity(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const env of this.config.environments) {
      results.set(env.name, await this.verifyConnectivity(env.name));
    }
    return results;
  }

  /**
   * Pre-load entity names for all environments
   */
  async preloadAllMetadata(): Promise<void> {
    const promises = this.config.environments.map(async env => {
      try {
        const cache = this.getMetadataCache(env.name);
        await cache.ensureEntityNamesLoaded();
        log(`Metadata preloaded for environment: ${env.name}`);
      } catch (error) {
        log(`Failed to preload metadata for environment ${env.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    await Promise.all(promises);
  }
}
