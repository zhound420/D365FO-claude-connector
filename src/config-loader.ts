/**
 * Configuration loader for D365 MCP Server
 * Supports multi-environment JSON config with fallback to legacy env vars
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { D365Config, EnvironmentConfig, EnvironmentsConfig, EnvironmentType } from "./types.js";
import { log, logError } from "./config.js";

/**
 * Default config file paths to search (in order)
 */
const CONFIG_FILE_PATHS = [
  "./d365-environments.json",
  join(process.cwd(), "d365-environments.json"),
];

/**
 * Custom error for configuration issues
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * Validate a single environment configuration
 */
function validateEnvironmentConfig(env: unknown, index: number): EnvironmentConfig {
  if (!env || typeof env !== "object") {
    throw new ConfigurationError(`Environment at index ${index} is not a valid object`);
  }

  const e = env as Record<string, unknown>;

  // Required fields
  const requiredFields = ["name", "displayName", "type", "tenantId", "clientId", "clientSecret", "environmentUrl"];
  for (const field of requiredFields) {
    if (!e[field] || typeof e[field] !== "string") {
      throw new ConfigurationError(`Environment "${e.name || index}": missing or invalid "${field}"`);
    }
  }

  // Validate type
  const validTypes: EnvironmentType[] = ["production", "non-production"];
  if (!validTypes.includes(e.type as EnvironmentType)) {
    throw new ConfigurationError(
      `Environment "${e.name}": type must be "production" or "non-production", got "${e.type}"`
    );
  }

  // Normalize environment URL (remove trailing slash)
  let environmentUrl = e.environmentUrl as string;
  environmentUrl = environmentUrl.replace(/\/+$/, "");

  return {
    name: e.name as string,
    displayName: e.displayName as string,
    type: e.type as EnvironmentType,
    tenantId: e.tenantId as string,
    clientId: e.clientId as string,
    clientSecret: e.clientSecret as string,
    environmentUrl,
    default: e.default === true,
  };
}

/**
 * Load and validate the JSON configuration file
 */
function loadJsonConfig(filePath: string): EnvironmentsConfig {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as unknown;

    if (!parsed || typeof parsed !== "object") {
      throw new ConfigurationError("Configuration file must be a JSON object");
    }

    const config = parsed as Record<string, unknown>;

    if (!Array.isArray(config.environments)) {
      throw new ConfigurationError("Configuration must have an 'environments' array");
    }

    if (config.environments.length === 0) {
      throw new ConfigurationError("Configuration must have at least one environment");
    }

    const environments = config.environments.map((env, index) =>
      validateEnvironmentConfig(env, index)
    );

    // Validate unique names
    const names = new Set<string>();
    for (const env of environments) {
      if (names.has(env.name)) {
        throw new ConfigurationError(`Duplicate environment name: "${env.name}"`);
      }
      names.add(env.name);
    }

    // Ensure exactly one default (or first env becomes default)
    const defaults = environments.filter(e => e.default);
    if (defaults.length > 1) {
      throw new ConfigurationError("Only one environment can be marked as default");
    }
    if (defaults.length === 0) {
      environments[0].default = true;
    }

    return { environments };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new ConfigurationError(`Invalid JSON in configuration file: ${error.message}`);
    }
    throw new ConfigurationError(`Failed to load configuration file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Create environment config from legacy environment variables
 */
function loadLegacyEnvConfig(): EnvironmentsConfig {
  const tenantId = process.env.D365_TENANT_ID;
  const clientId = process.env.D365_CLIENT_ID;
  const clientSecret = process.env.D365_CLIENT_SECRET;
  let environmentUrl = process.env.D365_ENVIRONMENT_URL;

  if (!tenantId) {
    throw new ConfigurationError("D365_TENANT_ID environment variable is required");
  }
  if (!clientId) {
    throw new ConfigurationError("D365_CLIENT_ID environment variable is required");
  }
  if (!clientSecret) {
    throw new ConfigurationError("D365_CLIENT_SECRET environment variable is required");
  }
  if (!environmentUrl) {
    throw new ConfigurationError("D365_ENVIRONMENT_URL environment variable is required");
  }

  // Remove trailing slash
  environmentUrl = environmentUrl.replace(/\/+$/, "");

  // Determine environment type from URL or explicit setting
  const envType = process.env.D365_ENVIRONMENT_TYPE as EnvironmentType | undefined;
  let type: EnvironmentType = "production"; // Default to production for safety

  if (envType) {
    if (envType !== "production" && envType !== "non-production") {
      throw new ConfigurationError(
        `D365_ENVIRONMENT_TYPE must be "production" or "non-production", got "${envType}"`
      );
    }
    type = envType;
  } else {
    // Infer from URL - sandbox URLs are non-production
    if (environmentUrl.includes(".sandbox.") || environmentUrl.includes("-uat") || environmentUrl.includes("-dev") || environmentUrl.includes("-test")) {
      type = "non-production";
    }
  }

  const envName = process.env.D365_ENVIRONMENT_NAME || "default";
  const displayName = process.env.D365_ENVIRONMENT_DISPLAY_NAME || (type === "production" ? "Production" : "Default Environment");

  return {
    environments: [
      {
        name: envName,
        displayName,
        type,
        tenantId,
        clientId,
        clientSecret,
        environmentUrl,
        default: true,
      },
    ],
  };
}

/**
 * Find the configuration file path
 */
function findConfigFile(): string | null {
  // Check environment variable first
  const envPath = process.env.D365_CONFIG_FILE;
  if (envPath) {
    if (existsSync(envPath)) {
      return envPath;
    }
    logError(`Config file specified in D365_CONFIG_FILE not found: ${envPath}`);
  }

  // Check default paths
  for (const path of CONFIG_FILE_PATHS) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

/**
 * Load environments configuration
 * Tries JSON config file first, falls back to legacy env vars
 */
export function loadEnvironmentsConfig(): EnvironmentsConfig {
  const configPath = findConfigFile();

  if (configPath) {
    log(`Loading configuration from: ${configPath}`);
    return loadJsonConfig(configPath);
  }

  // Fall back to legacy environment variables
  log("No config file found, using environment variables");
  return loadLegacyEnvConfig();
}

/**
 * Get the default environment from config
 */
export function getDefaultEnvironment(config: EnvironmentsConfig): EnvironmentConfig {
  const defaultEnv = config.environments.find(e => e.default);
  if (!defaultEnv) {
    throw new ConfigurationError("No default environment configured");
  }
  return defaultEnv;
}

/**
 * Get environment by name
 */
export function getEnvironmentByName(config: EnvironmentsConfig, name: string): EnvironmentConfig | undefined {
  return config.environments.find(e => e.name === name);
}

/**
 * Convert EnvironmentConfig to D365Config (for backward compatibility)
 */
export function toD365Config(env: EnvironmentConfig): D365Config {
  return {
    tenantId: env.tenantId,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    environmentUrl: env.environmentUrl,
  };
}
