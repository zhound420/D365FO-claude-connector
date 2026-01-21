/**
 * Date utility functions for period calculations
 */

/**
 * Comparison types for period analysis
 */
export type ComparisonType = "YoY" | "QoQ" | "MoM" | "custom";

/**
 * Granularity levels for trending analysis
 */
export type Granularity = "day" | "week" | "month" | "quarter" | "year";

/**
 * Period definition with start and end dates
 */
export interface DatePeriod {
  start: Date;
  end: Date;
  label: string;
}

/**
 * Parse a date string in YYYY-MM-DD or ISO format
 */
export function parseDate(dateStr: string): Date {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD or ISO format.`);
  }
  return date;
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Format date as ISO datetime for OData filter
 */
export function formatDateTime(date: Date): string {
  return date.toISOString();
}

/**
 * Get start of day (00:00:00)
 */
export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get end of day (23:59:59.999)
 */
export function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Get start of week (Monday)
 */
export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get start of month
 */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * Get end of month
 */
export function endOfMonth(date: Date): Date {
  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return new Date(nextMonth.getTime() - 1);
}

/**
 * Get start of quarter
 */
export function startOfQuarter(date: Date): Date {
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterStartMonth, 1, 0, 0, 0, 0);
}

/**
 * Get end of quarter
 */
export function endOfQuarter(date: Date): Date {
  const quarterEndMonth = Math.floor(date.getMonth() / 3) * 3 + 3;
  const nextQuarter = new Date(date.getFullYear(), quarterEndMonth, 1);
  return new Date(nextQuarter.getTime() - 1);
}

/**
 * Get start of year
 */
export function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
}

/**
 * Get end of year
 */
export function endOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add weeks to a date
 */
export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

/**
 * Add months to a date
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Add quarters to a date
 */
export function addQuarters(date: Date, quarters: number): Date {
  return addMonths(date, quarters * 3);
}

/**
 * Add years to a date
 */
export function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

/**
 * Get comparison periods based on comparison type
 */
export function getComparisonPeriods(
  comparisonType: ComparisonType,
  referenceDate: Date = new Date()
): { current: DatePeriod; previous: DatePeriod } {
  const ref = startOfDay(referenceDate);

  switch (comparisonType) {
    case "YoY": {
      // Current period: start of current year to reference date
      // Previous period: same period last year
      const currentStart = startOfYear(ref);
      const currentEnd = endOfDay(ref);
      const previousStart = addYears(currentStart, -1);
      const previousEnd = addYears(currentEnd, -1);

      return {
        current: {
          start: currentStart,
          end: currentEnd,
          label: `${ref.getFullYear()} YTD`,
        },
        previous: {
          start: previousStart,
          end: previousEnd,
          label: `${ref.getFullYear() - 1} YTD`,
        },
      };
    }

    case "QoQ": {
      // Current quarter vs previous quarter
      const currentStart = startOfQuarter(ref);
      const currentEnd = endOfQuarter(ref);
      const previousStart = addQuarters(currentStart, -1);
      const previousEnd = addQuarters(currentEnd, -1);

      const currentQ = Math.floor(ref.getMonth() / 3) + 1;
      const previousQ = currentQ === 1 ? 4 : currentQ - 1;
      const previousYear = currentQ === 1 ? ref.getFullYear() - 1 : ref.getFullYear();

      return {
        current: {
          start: currentStart,
          end: currentEnd,
          label: `Q${currentQ} ${ref.getFullYear()}`,
        },
        previous: {
          start: previousStart,
          end: previousEnd,
          label: `Q${previousQ} ${previousYear}`,
        },
      };
    }

    case "MoM": {
      // Current month vs previous month
      const currentStart = startOfMonth(ref);
      const currentEnd = endOfMonth(ref);
      const previousStart = addMonths(currentStart, -1);
      const previousEnd = endOfMonth(previousStart);

      const monthNames = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];

      return {
        current: {
          start: currentStart,
          end: currentEnd,
          label: `${monthNames[ref.getMonth()]} ${ref.getFullYear()}`,
        },
        previous: {
          start: previousStart,
          end: previousEnd,
          label: `${monthNames[previousStart.getMonth()]} ${previousStart.getFullYear()}`,
        },
      };
    }

    default:
      throw new Error(`Unknown comparison type: ${comparisonType}`);
  }
}

/**
 * Get the bucket key for a date based on granularity
 */
export function getBucketKey(date: Date, granularity: Granularity): string {
  switch (granularity) {
    case "day":
      return formatDate(date);

    case "week": {
      const weekStart = startOfWeek(date);
      return formatDate(weekStart);
    }

    case "month":
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

    case "quarter": {
      const quarter = Math.floor(date.getMonth() / 3) + 1;
      return `${date.getFullYear()}-Q${quarter}`;
    }

    case "year":
      return String(date.getFullYear());

    default:
      throw new Error(`Unknown granularity: ${granularity}`);
  }
}

/**
 * Get the start date of a bucket
 */
export function getBucketStartDate(bucketKey: string, granularity: Granularity): Date {
  switch (granularity) {
    case "day":
      return parseDate(bucketKey);

    case "week":
      return parseDate(bucketKey);

    case "month": {
      const [year, month] = bucketKey.split("-");
      return new Date(parseInt(year), parseInt(month) - 1, 1);
    }

    case "quarter": {
      const match = bucketKey.match(/^(\d{4})-Q(\d)$/);
      if (!match) throw new Error(`Invalid quarter key: ${bucketKey}`);
      const year = parseInt(match[1]);
      const quarter = parseInt(match[2]);
      return new Date(year, (quarter - 1) * 3, 1);
    }

    case "year":
      return new Date(parseInt(bucketKey), 0, 1);

    default:
      throw new Error(`Unknown granularity: ${granularity}`);
  }
}

/**
 * Generate period start dates for trending analysis
 */
export function generatePeriodStarts(
  endDate: Date,
  granularity: Granularity,
  periods: number
): Date[] {
  const result: Date[] = [];
  let current: Date;

  switch (granularity) {
    case "day":
      current = startOfDay(endDate);
      for (let i = 0; i < periods; i++) {
        result.unshift(new Date(current));
        current = addDays(current, -1);
      }
      break;

    case "week":
      current = startOfWeek(endDate);
      for (let i = 0; i < periods; i++) {
        result.unshift(new Date(current));
        current = addWeeks(current, -1);
      }
      break;

    case "month":
      current = startOfMonth(endDate);
      for (let i = 0; i < periods; i++) {
        result.unshift(new Date(current));
        current = addMonths(current, -1);
      }
      break;

    case "quarter":
      current = startOfQuarter(endDate);
      for (let i = 0; i < periods; i++) {
        result.unshift(new Date(current));
        current = addQuarters(current, -1);
      }
      break;

    case "year":
      current = startOfYear(endDate);
      for (let i = 0; i < periods; i++) {
        result.unshift(new Date(current));
        current = addYears(current, -1);
      }
      break;
  }

  return result;
}

/**
 * Build OData date filter expression
 */
export function buildDateFilter(
  dateField: string,
  start: Date,
  end: Date
): string {
  const startStr = formatDateTime(start);
  const endStr = formatDateTime(end);
  return `${dateField} ge ${startStr} and ${dateField} le ${endStr}`;
}
