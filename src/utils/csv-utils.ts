/**
 * CSV/TSV formatting utilities
 */

/**
 * Supported export formats
 */
export type ExportFormat = "json" | "csv" | "tsv";

/**
 * Escape a value for CSV format
 * - Wrap in quotes if contains comma, quote, or newline
 * - Double any quotes within the value
 */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const str = String(value);

  // Check if escaping is needed
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    // Escape quotes by doubling them
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return str;
}

/**
 * Escape a value for TSV format
 * - Replace tabs with spaces
 * - Replace newlines with spaces
 */
export function escapeTsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/\t/g, " ")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ");
}

/**
 * Get delimiter for format
 */
export function getDelimiter(format: ExportFormat): string {
  switch (format) {
    case "csv":
      return ",";
    case "tsv":
      return "\t";
    default:
      return ",";
  }
}

/**
 * Get escape function for format
 */
export function getEscapeFunction(format: ExportFormat): (value: unknown) => string {
  switch (format) {
    case "csv":
      return escapeCsvValue;
    case "tsv":
      return escapeTsvValue;
    default:
      return escapeCsvValue;
  }
}

/**
 * Format a single row
 */
export function formatRow(
  values: unknown[],
  format: ExportFormat
): string {
  const delimiter = getDelimiter(format);
  const escape = getEscapeFunction(format);
  return values.map(escape).join(delimiter);
}

/**
 * Extract headers from records
 */
export function extractHeaders(records: Record<string, unknown>[]): string[] {
  const headerSet = new Set<string>();

  for (const record of records) {
    for (const key of Object.keys(record)) {
      // Skip OData metadata fields
      if (!key.startsWith("@odata.")) {
        headerSet.add(key);
      }
    }
  }

  return Array.from(headerSet).sort();
}

/**
 * Format records as CSV/TSV string
 */
export function formatRecords(
  records: Record<string, unknown>[],
  format: ExportFormat,
  options: {
    includeHeaders?: boolean;
    select?: string[];
  } = {}
): string {
  const { includeHeaders = true, select } = options;

  if (records.length === 0) {
    return includeHeaders ? "(no records)" : "";
  }

  // Determine headers
  let headers: string[];
  if (select && select.length > 0) {
    headers = select;
  } else {
    headers = extractHeaders(records);
  }

  const lines: string[] = [];

  // Add header row
  if (includeHeaders) {
    lines.push(formatRow(headers, format));
  }

  // Add data rows
  for (const record of records) {
    const values = headers.map((header) => record[header]);
    lines.push(formatRow(values, format));
  }

  return lines.join("\n");
}

/**
 * Get file extension for format
 */
export function getFileExtension(format: ExportFormat): string {
  switch (format) {
    case "json":
      return "json";
    case "csv":
      return "csv";
    case "tsv":
      return "tsv";
    default:
      return "txt";
  }
}

/**
 * Get MIME type for format
 */
export function getMimeType(format: ExportFormat): string {
  switch (format) {
    case "json":
      return "application/json";
    case "csv":
      return "text/csv";
    case "tsv":
      return "text/tab-separated-values";
    default:
      return "text/plain";
  }
}
