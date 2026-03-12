/**
 * Common schema definitions and utilities for D365 tools
 */

import { z } from "zod";
import { D365Error } from "../d365-client.js";

/**
 * Common environment parameter schema
 * All tools should include this parameter for multi-environment support
 */
export const environmentSchema = z.string().optional().describe(
  "Target D365 environment name. If omitted, uses the environment set via " +
  "'set_environment' tool, or falls back to the default environment. " +
  "Use list_environments to see available environments."
);

/**
 * Helper to format environment info in tool output
 * Uses prominent visual indicators to make environment type unmistakable
 */
export function formatEnvironmentHeader(envName: string, envDisplayName: string, isProduction: boolean): string {
  if (isProduction) {
    return `🔴 PRODUCTION: ${envDisplayName} (${envName}) [read-only]`;
  } else {
    return `🟢 ${envDisplayName.toUpperCase()}: ${envName} [read/write]`;
  }
}

/**
 * Format an error for tool output.
 * Handles D365Error (with status code and OData details), standard Error, and unknown types.
 */
export function formatToolError(error: unknown, context?: string): string {
  const prefix = context ? `${context}: ` : "";

  if (error instanceof D365Error) {
    let message = error.message;
    if (error.statusCode === 429 && error.retryAfter) {
      message += ` (retry after ${error.retryAfter}s)`;
    }
    return `${prefix}${message}`;
  }

  if (error instanceof Error) {
    return `${prefix}${error.message}`;
  }

  return `${prefix}${String(error)}`;
}
