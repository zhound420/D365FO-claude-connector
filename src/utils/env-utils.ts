/**
 * Environment variable parsing utilities with validation
 */

/**
 * Parse an integer from an environment variable with validation.
 * Returns the default value if the env var is not set or is invalid.
 *
 * @param name - Environment variable name
 * @param defaultVal - Default value if env var is missing or invalid
 * @param min - Optional minimum allowed value (inclusive)
 * @param max - Optional maximum allowed value (inclusive)
 */
export function parseEnvInt(
  name: string,
  defaultVal: number,
  min?: number,
  max?: number
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return defaultVal;
  }

  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    return defaultVal;
  }

  if (min !== undefined && parsed < min) {
    return defaultVal;
  }

  if (max !== undefined && parsed > max) {
    return defaultVal;
  }

  return parsed;
}
