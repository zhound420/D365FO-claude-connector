/**
 * Analyze Customer tool - comprehensive single-call customer analysis
 * Runs parallel queries for profile, orders, spend, and trending data
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import type { EnvironmentManager } from "../environment-manager.js";
import { D365Client, D365Error } from "../d365-client.js";
import type { ODataResponse } from "../types.js";
import { ProgressReporter } from "../progress.js";
import {
  type Granularity,
  getBucketKey,
  generatePeriodStarts,
} from "../utils/date-utils.js";
import { environmentSchema } from "./common.js";

/**
 * Default values
 */
const DEFAULT_RECENT_ORDERS = 10;
const DEFAULT_TREND_PERIODS = 12;

/**
 * Customer profile data
 */
interface CustomerProfile {
  CustomerAccount: string;
  CustomerName?: string;
  CustomerGroup?: string;
  Currency?: string;
  AddressStreet?: string;
  AddressCity?: string;
  AddressState?: string;
  AddressCountryRegion?: string;
  AddressZipCode?: string;
  [key: string]: unknown;
}

/**
 * Customer analysis summary
 */
interface CustomerSummary {
  totalOrders: number;
  totalSpend: number;
  averageOrderValue: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
}

/**
 * Monthly trend data point
 */
interface TrendDataPoint {
  period: string;
  orderCount: number;
  revenue: number;
}

/**
 * Complete analysis result
 */
interface AnalysisResult {
  customer: CustomerProfile | null;
  summary: CustomerSummary;
  recentOrders: Record<string, unknown>[];
  monthlyTrend: TrendDataPoint[];
}

/**
 * Escape special characters in OData string values
 */
function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Search for customer by name with fallback strategies
 */
async function findCustomerByName(
  client: D365Client,
  searchTerm: string,
  progress: ProgressReporter
): Promise<CustomerProfile | null> {
  const escapedTerm = escapeODataString(searchTerm);
  const searchTermLower = searchTerm.toLowerCase();

  // Strategy 1: Try contains()
  try {
    await progress.report("Searching for customer (contains)...");
    const filter = `contains(CustomerName, '${escapedTerm}')`;
    const path = `/CustomersV3?$filter=${encodeURIComponent(filter)}&$top=1`;
    const response: ODataResponse<CustomerProfile> = await client.request(path);
    if (response.value && response.value.length > 0) {
      return response.value[0];
    }
  } catch {
    // Try next strategy
  }

  // Strategy 2: Try startswith()
  try {
    await progress.report("Searching for customer (startswith)...");
    const filter = `startswith(CustomerName, '${escapedTerm}')`;
    const path = `/CustomersV3?$filter=${encodeURIComponent(filter)}&$top=1`;
    const response: ODataResponse<CustomerProfile> = await client.request(path);
    if (response.value && response.value.length > 0) {
      return response.value[0];
    }
  } catch {
    // Try next strategy
  }

  // Strategy 3: Fetch and filter client-side
  try {
    await progress.report("Searching for customer (client-side filter)...");
    const path = `/CustomersV3?$top=1000&$select=CustomerAccount,CustomerName,CustomerGroup,Currency,dataAreaId`;
    const response: ODataResponse<CustomerProfile> = await client.request(path);

    if (response.value) {
      const match = response.value.find((c) => {
        const name = c.CustomerName;
        return typeof name === "string" && name.toLowerCase().includes(searchTermLower);
      });
      if (match) {
        // Fetch full customer record using dataAreaId from the match
        const dataAreaId = (match as Record<string, unknown>).dataAreaId as string | undefined;
        if (dataAreaId) {
          const fullPath = `/CustomersV3(dataAreaId='${escapeODataString(dataAreaId)}',CustomerAccount='${escapeODataString(match.CustomerAccount)}')`;
          try {
            return await client.request<CustomerProfile>(fullPath);
          } catch {
            return match;
          }
        }
        return match;
      }
    }
  } catch {
    // All strategies failed
  }

  return null;
}

/**
 * Get customer profile by account number
 */
async function getCustomerByAccount(
  client: D365Client,
  customerAccount: string
): Promise<CustomerProfile | null> {
  try {
    // Try with common data area IDs
    const dataAreas = ["usmf", "usrt", "dat"];
    for (const dataArea of dataAreas) {
      try {
        const path = `/CustomersV3(dataAreaId='${dataArea}',CustomerAccount='${escapeODataString(customerAccount)}')`;
        return await client.request<CustomerProfile>(path);
      } catch {
        // Try next data area
      }
    }

    // Fallback: search by account filter
    const filter = `CustomerAccount eq '${escapeODataString(customerAccount)}'`;
    const path = `/CustomersV3?$filter=${encodeURIComponent(filter)}&$top=1`;
    const response: ODataResponse<CustomerProfile> = await client.request(path);
    if (response.value && response.value.length > 0) {
      return response.value[0];
    }
  } catch {
    // Failed to find customer
  }

  return null;
}

/**
 * Get order count using fast /$count endpoint
 */
async function getOrderCount(
  client: D365Client,
  customerAccount: string
): Promise<number> {
  try {
    const filter = `OrderingCustomerAccountNumber eq '${escapeODataString(customerAccount)}'`;
    const path = `/SalesOrderHeadersV2/$count?$filter=${encodeURIComponent(filter)}`;
    return await client.request<number>(path);
  } catch {
    return 0;
  }
}

/**
 * Get total spend by aggregating line amounts (accurate mode)
 * Uses SalesOrderLinesV2 because header totals may be $0
 */
async function getTotalSpend(
  client: D365Client,
  customerAccount: string,
  progress: ProgressReporter
): Promise<number> {
  try {
    await progress.report("Calculating total spend...");

    const filter = `OrderingCustomerAccountNumber eq '${escapeODataString(customerAccount)}'`;
    let path = `/SalesOrderLinesV2?$select=LineAmount&$filter=${encodeURIComponent(filter)}`;

    let totalSpend = 0;
    let nextLink: string | undefined = path;
    let pageCount = 0;

    while (nextLink) {
      const response: ODataResponse<{ LineAmount: number }> = await client.request(nextLink);
      pageCount++;

      if (response.value) {
        for (const line of response.value) {
          if (typeof line.LineAmount === "number") {
            totalSpend += line.LineAmount;
          }
        }
      }

      if (pageCount > 1) {
        await progress.report(`Processing spend data (page ${pageCount})...`);
      }

      nextLink = response["@odata.nextLink"];
    }

    return totalSpend;
  } catch {
    return 0;
  }
}

/**
 * Get recent orders
 */
async function getRecentOrders(
  client: D365Client,
  customerAccount: string,
  limit: number
): Promise<Record<string, unknown>[]> {
  try {
    const filter = `OrderingCustomerAccountNumber eq '${escapeODataString(customerAccount)}'`;
    const select = "SalesOrderNumber,OrderCreatedDateTime,CurrencyCode,SalesOrderStatus";
    const path = `/SalesOrderHeadersV2?$filter=${encodeURIComponent(filter)}&$select=${select}&$orderby=OrderCreatedDateTime desc&$top=${limit}`;

    const response: ODataResponse<Record<string, unknown>> = await client.request(path);
    return response.value || [];
  } catch {
    return [];
  }
}

/**
 * Get first and last order dates
 */
async function getOrderDateRange(
  client: D365Client,
  customerAccount: string
): Promise<{ firstOrderDate: string | null; lastOrderDate: string | null }> {
  const filter = `OrderingCustomerAccountNumber eq '${escapeODataString(customerAccount)}'`;

  try {
    // Get first order (oldest)
    const firstPath = `/SalesOrderHeadersV2?$filter=${encodeURIComponent(filter)}&$select=OrderCreatedDateTime&$orderby=OrderCreatedDateTime asc&$top=1`;
    const firstResponse: ODataResponse<{ OrderCreatedDateTime: string }> = await client.request(firstPath);

    // Get last order (newest)
    const lastPath = `/SalesOrderHeadersV2?$filter=${encodeURIComponent(filter)}&$select=OrderCreatedDateTime&$orderby=OrderCreatedDateTime desc&$top=1`;
    const lastResponse: ODataResponse<{ OrderCreatedDateTime: string }> = await client.request(lastPath);

    return {
      firstOrderDate: firstResponse.value?.[0]?.OrderCreatedDateTime || null,
      lastOrderDate: lastResponse.value?.[0]?.OrderCreatedDateTime || null,
    };
  } catch {
    return { firstOrderDate: null, lastOrderDate: null };
  }
}

/**
 * Get monthly order trend data
 */
async function getMonthlyTrend(
  client: D365Client,
  customerAccount: string,
  periods: number,
  progress: ProgressReporter
): Promise<TrendDataPoint[]> {
  try {
    await progress.report("Calculating monthly trend...");

    const granularity: Granularity = "month";
    const endDate = new Date();
    const periodStarts = generatePeriodStarts(endDate, granularity, periods);

    if (periodStarts.length === 0) {
      return [];
    }

    // Initialize buckets
    const buckets = new Map<string, { orderCount: number; revenue: number }>();
    for (const periodStart of periodStarts) {
      const key = getBucketKey(periodStart, granularity);
      buckets.set(key, { orderCount: 0, revenue: 0 });
    }

    // Fetch order lines with dates and amounts
    const filter = `OrderingCustomerAccountNumber eq '${escapeODataString(customerAccount)}'`;
    let path = `/SalesOrderLinesV2?$select=LineAmount,CreatedDateTime&$filter=${encodeURIComponent(filter)}`;

    let nextLink: string | undefined = path;

    while (nextLink) {
      const response: ODataResponse<{ LineAmount: number; CreatedDateTime: string }> = await client.request(nextLink);

      if (response.value) {
        for (const line of response.value) {
          if (!line.CreatedDateTime) continue;

          const recordDate = new Date(line.CreatedDateTime);
          if (isNaN(recordDate.getTime())) continue;

          const bucketKey = getBucketKey(recordDate, granularity);
          const bucket = buckets.get(bucketKey);

          if (bucket) {
            bucket.orderCount++;
            if (typeof line.LineAmount === "number") {
              bucket.revenue += line.LineAmount;
            }
          }
        }
      }

      nextLink = response["@odata.nextLink"];
    }

    // Convert to array in chronological order
    const trend: TrendDataPoint[] = [];
    for (const periodStart of periodStarts) {
      const key = getBucketKey(periodStart, granularity);
      const bucket = buckets.get(key)!;
      trend.push({
        period: key,
        orderCount: bucket.orderCount,
        revenue: bucket.revenue,
      });
    }

    return trend;
  } catch {
    return [];
  }
}

/**
 * Format analysis results for output
 */
function formatAnalysisResults(result: AnalysisResult, elapsedMs: number): string {
  const lines: string[] = [];

  // Customer Profile
  lines.push("# Customer Analysis Report");
  lines.push("");

  if (result.customer) {
    lines.push("## Customer Profile");
    lines.push(`- Account: ${result.customer.CustomerAccount}`);
    if (result.customer.CustomerName) {
      lines.push(`- Name: ${result.customer.CustomerName}`);
    }
    if (result.customer.CustomerGroup) {
      lines.push(`- Group: ${result.customer.CustomerGroup}`);
    }
    if (result.customer.Currency) {
      lines.push(`- Currency: ${result.customer.Currency}`);
    }

    // Address
    const addressParts = [
      result.customer.AddressStreet,
      result.customer.AddressCity,
      result.customer.AddressState,
      result.customer.AddressZipCode,
      result.customer.AddressCountryRegion,
    ].filter(Boolean);
    if (addressParts.length > 0) {
      lines.push(`- Address: ${addressParts.join(", ")}`);
    }
    lines.push("");
  } else {
    lines.push("## Customer Profile");
    lines.push("Customer not found.");
    lines.push("");
  }

  // Summary Statistics
  lines.push("## Summary Statistics");
  lines.push(`- Total Orders: ${result.summary.totalOrders.toLocaleString()}`);
  lines.push(`- Total Spend: $${result.summary.totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push(`- Average Order Value: $${result.summary.averageOrderValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  if (result.summary.firstOrderDate) {
    lines.push(`- First Order: ${result.summary.firstOrderDate.split("T")[0]}`);
  }
  if (result.summary.lastOrderDate) {
    lines.push(`- Last Order: ${result.summary.lastOrderDate.split("T")[0]}`);
  }
  lines.push("");

  // Recent Orders
  if (result.recentOrders.length > 0) {
    lines.push("## Recent Orders");
    for (const order of result.recentOrders) {
      const orderNum = order.SalesOrderNumber || "Unknown";
      const date = order.OrderCreatedDateTime
        ? String(order.OrderCreatedDateTime).split("T")[0]
        : "Unknown date";
      const status = order.SalesOrderStatus || "";
      lines.push(`- ${orderNum} (${date}) ${status}`);
    }
    lines.push("");
  }

  // Monthly Trend
  if (result.monthlyTrend.length > 0) {
    lines.push("## Monthly Order Trend");
    lines.push("Period\t\tOrders\tRevenue");
    lines.push("-".repeat(40));
    for (const point of result.monthlyTrend) {
      const revenue = `$${point.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      lines.push(`${point.period}\t\t${point.orderCount}\t${revenue}`);
    }
    lines.push("");
  }

  // Timing
  if (elapsedMs >= 2000) {
    lines.push(`Analysis completed in ${(elapsedMs / 1000).toFixed(1)}s`);
  }

  return lines.join("\n");
}

/**
 * Register the analyze_customer tool
 */
export function registerAnalyzeCustomerTool(server: McpServer, envManager: EnvironmentManager): void {
  server.tool(
    "analyze_customer",
    `Comprehensive customer analysis in a single call.

Runs parallel queries to gather:
- Customer profile (name, account, group, address)
- Order statistics (count, total spend, average order value)
- Order date range (first and last order)
- Recent orders list
- Monthly order trending (last 12 months)

Uses efficient aggregation at the line level (SalesOrderLinesV2) for accurate spend
calculation, avoiding the $0 header total issue.

Examples:
- By account: customerAccount="SS0011"
- By name: customerName="S&S" (handles special characters)
- Without trending: includeTrending=false (faster)`,
    {
      customerAccount: z.string().optional().describe("Customer account number (e.g., 'SS0011')"),
      customerName: z.string().optional().describe("Customer name to search (e.g., 'S&S')"),
      includeOrders: z.boolean().optional().default(true).describe("Include recent orders list (default: true)"),
      includeSpend: z.boolean().optional().default(true).describe("Include total spend calculation (default: true)"),
      includeTrending: z.boolean().optional().default(true).describe("Include monthly trend analysis (default: true)"),
      recentOrdersLimit: z.number().optional().default(DEFAULT_RECENT_ORDERS).describe(`Number of recent orders to show (default: ${DEFAULT_RECENT_ORDERS})`),
      trendPeriods: z.number().optional().default(DEFAULT_TREND_PERIODS).describe(`Number of months for trend (default: ${DEFAULT_TREND_PERIODS})`),
      environment: environmentSchema,
    },
    async (
      { customerAccount, customerName, includeOrders, includeSpend, includeTrending, recentOrdersLimit, trendPeriods, environment },
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>
    ) => {
      const client = envManager.getClient(environment);
      const startTime = Date.now();
      const progress = new ProgressReporter(server, "analyze_customer", extra.sessionId);

      try {
        // Validate: at least one of customerAccount or customerName required
        if (!customerAccount && !customerName) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Either customerAccount or customerName must be provided.",
              },
            ],
            isError: true,
          };
        }

        // Step 1: Find the customer
        await progress.report("Looking up customer...");
        let customer: CustomerProfile | null = null;

        if (customerAccount) {
          customer = await getCustomerByAccount(client, customerAccount);
        } else if (customerName) {
          customer = await findCustomerByName(client, customerName, progress);
        }

        if (!customer) {
          return {
            content: [
              {
                type: "text",
                text: `Customer not found: ${customerAccount || customerName}\n\nTry using search_entity to find the exact customer account number.`,
              },
            ],
            isError: true,
          };
        }

        const account = customer.CustomerAccount;

        // Step 2: Run parallel queries for remaining data
        await progress.report("Gathering order data...");

        // Run queries in parallel where possible
        const [orderCount, dateRange] = await Promise.all([
          getOrderCount(client, account),
          getOrderDateRange(client, account),
        ]);

        // Run conditional queries
        const [recentOrders, totalSpend, monthlyTrend] = await Promise.all([
          includeOrders ? getRecentOrders(client, account, recentOrdersLimit) : Promise.resolve([]),
          includeSpend ? getTotalSpend(client, account, progress) : Promise.resolve(0),
          includeTrending ? getMonthlyTrend(client, account, trendPeriods, progress) : Promise.resolve([]),
        ]);

        // Calculate average order value
        const averageOrderValue = orderCount > 0 ? totalSpend / orderCount : 0;

        // Build result
        const result: AnalysisResult = {
          customer,
          summary: {
            totalOrders: orderCount,
            totalSpend,
            averageOrderValue,
            firstOrderDate: dateRange.firstOrderDate,
            lastOrderDate: dateRange.lastOrderDate,
          },
          recentOrders,
          monthlyTrend,
        };

        const elapsedMs = Date.now() - startTime;
        const output = formatAnalysisResults(result, elapsedMs);

        return {
          content: [
            {
              type: "text",
              text: output,
            },
          ],
        };
      } catch (error) {
        let message: string;
        if (error instanceof D365Error) {
          message = error.message;
        } else {
          message = `Analysis error: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
