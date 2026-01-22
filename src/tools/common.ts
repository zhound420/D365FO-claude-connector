/**
 * Common schema definitions and utilities for D365 tools
 */

import { z } from "zod";

/**
 * Common environment parameter schema
 * All tools should include this parameter for multi-environment support
 */
export const environmentSchema = z.string().optional().describe(
  "Target D365 environment name. If not specified, uses the default environment. Use list_environments to see available environments."
);

/**
 * Helper to format environment info in tool output
 */
export function formatEnvironmentHeader(envName: string, envDisplayName: string, isProduction: boolean): string {
  const envType = isProduction ? "[PRODUCTION - read-only]" : "[non-production]";
  return `Environment: ${envDisplayName} (${envName}) ${envType}`;
}
