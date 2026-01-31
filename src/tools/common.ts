/**
 * Common schema definitions and utilities for D365 tools
 */

import { z } from "zod";

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
