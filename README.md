# D365 Finance & Operations MCP Server

An MCP (Model Context Protocol) server that provides read access to Microsoft Dynamics 365 Finance & Operations environments. Enables AI assistants like Claude to explore D365 metadata, query data, and execute custom logic through a secure sandbox.

## Features

- **MCP Resources** for schema discovery and metadata exploration
- **Consolidated Tools** for flexible data access
- **Sandboxed JavaScript Execution** for complex operations with D365 API access
- **Secure Authentication** via Azure AD client credentials
- **Automatic Metadata Caching** (24-hour TTL)

## Architecture

### Resources

| Resource | URI | Purpose |
|----------|-----|---------|
| Entities List | `d365://entities?filter=<pattern>` | List all entities with optional wildcard filtering |
| Entity Schema | `d365://entity/{entityName}` | Full schema for any entity (fields, keys, navigation properties) |
| Enum Definitions | `d365://enums` | All enum types with their values |
| Saved Queries | `d365://queries` | List saved query templates |

### Tools

| Tool | Purpose |
|------|---------|
| `describe_entity` | Quick schema lookup for an entity |
| `execute_odata` | Execute raw OData paths (queries, single records, counts) |
| `execute_code` | Run JavaScript in a secure sandbox with D365 API access |
| `aggregate` | Perform aggregations (SUM, AVG, COUNT, MIN, MAX) on entity data |
| `get_related` | Follow entity relationships to retrieve related records |
| `export` | Export query results to CSV, JSON, or TSV format |
| `compare_periods` | YoY, QoQ, MoM period comparisons with change calculations |
| `trending` | Time series analysis with growth rates and moving averages |
| `save_query` | Save reusable query templates with parameter support |
| `execute_saved_query` | Execute saved query templates with parameter substitution |
| `delete_saved_query` | Delete saved query templates |
| `join_entities` | Cross-entity joins using $expand or client-side join |
| `batch_query` | Execute multiple queries in parallel |
| `search_entity` | Robust entity search with automatic fallback strategies |
| `analyze_customer` | Comprehensive single-call customer analysis |

## Installation

```bash
# Clone the repository
git clone https://github.com/zhound420/D365FO-claude-connector.git
cd d365fo-mcp-server

# Install dependencies
npm install

# Build
npm run build
```

## Configuration

The server requires the following environment variables:

| Variable | Description |
|----------|-------------|
| `D365_TENANT_ID` | Azure AD tenant ID |
| `D365_CLIENT_ID` | Azure AD application (client) ID |
| `D365_CLIENT_SECRET` | Azure AD client secret |
| `D365_ENVIRONMENT_URL` | D365 F&O environment URL (e.g., `https://contoso.operations.dynamics.com`) |

Optional:
| Variable | Default | Description |
|----------|---------|-------------|
| `D365_TRANSPORT` | `stdio` | Transport mode (`stdio` or `http`) |
| `D365_HTTP_PORT` | `3000` | HTTP port (when using http transport) |
| `D365_LOG_LEVEL` | `info` | Logging level |
| `D365_PAGINATION_TIMEOUT_MS` | `60000` | Timeout (ms) for paginated requests on large datasets |

### Azure AD App Registration

1. Create an Azure AD app registration
2. Add API permission: `Dynamics 365 Finance and Operations` > `CustomService.ReadWrite.All` (Application)
3. Grant admin consent
4. Create a client secret
5. Note the tenant ID, client ID, and secret

## Setup

### Claude Desktop

Add to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "Microsoft D365": {
      "command": "node",
      "args": ["/path/to/d365fo-mcp-server/dist/index.js"],
      "env": {
        "D365_TENANT_ID": "your-tenant-id",
        "D365_CLIENT_ID": "your-client-id",
        "D365_CLIENT_SECRET": "your-client-secret",
        "D365_ENVIRONMENT_URL": "https://your-env.operations.dynamics.com"
      }
    }
  }
}
```

### Claude Code (CLI)

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "Microsoft D365": {
      "command": "node",
      "args": ["/path/to/d365fo-mcp-server/dist/index.js"],
      "env": {
        "D365_TENANT_ID": "your-tenant-id",
        "D365_CLIENT_ID": "your-client-id",
        "D365_CLIENT_SECRET": "your-client-secret",
        "D365_ENVIRONMENT_URL": "https://your-env.operations.dynamics.com"
      }
    }
  }
}
```

After adding the configuration, restart Claude Desktop or Claude Code.

## Talking to Claude - Example Prompts

Once configured, you can ask Claude natural language questions about your D365 environment. Here are examples organized by capability:

### Discovering Entities

> **You:** What customer-related entities are available in D365?

Claude will use the `d365://entities?filter=*Cust*` resource to find matching entities.

> **You:** Show me the schema for the CustomersV3 entity

Claude will use `describe_entity` or the `d365://entity/CustomersV3` resource.

### Querying Data

> **You:** Get me the first 10 customers with their account numbers and names

Claude will use `execute_odata` with path `CustomersV3?$top=10&$select=CustomerAccount,CustomerName`

> **You:** How many sales orders are in the system?

Claude will use `execute_odata` with path `SalesOrderHeaders/$count`

> **You:** Find all customers in customer group "US" with credit limit over 50000

Claude will construct an OData filter query automatically.

### Aggregation & Analytics

> **You:** Who are our top 20 customers by total spend?

Claude will use `aggregate` with groupBy, orderBy, and top:
```json
{
  "entity": "SalesOrderLinesV2",
  "aggregations": [{"function": "SUM", "field": "LineAmount"}],
  "groupBy": ["OrderingCustomerAccountNumber"],
  "orderBy": "sum_LineAmount desc",
  "top": 20
}
```

> **You:** What's the median order value? Show me the 90th and 95th percentiles too

Claude will use `aggregate` with percentile functions:
```json
{
  "entity": "SalesOrderLinesV2",
  "aggregations": [
    {"function": "P50", "field": "LineAmount", "alias": "median"},
    {"function": "P90", "field": "LineAmount"},
    {"function": "P95", "field": "LineAmount"}
  ],
  "accurate": true
}
```

> **You:** Break down total revenue by product category

Claude will use `aggregate` with groupBy:
```json
{
  "entity": "SalesOrderLinesV2",
  "aggregations": [{"function": "SUM", "field": "LineAmount"}],
  "groupBy": ["ItemGroup"]
}
```

### Time-Based Analysis

> **You:** Show me the monthly sales trend for the past 12 months with growth rates

Claude will use `trending`:
```json
{
  "entity": "SalesOrderLinesV2",
  "dateField": "CreatedDateTime",
  "valueField": "LineAmount",
  "granularity": "month",
  "periods": 12,
  "includeGrowthRate": true
}
```

> **You:** Compare this year's sales to last year

Claude will use `compare_periods` with YoY comparison:
```json
{
  "entity": "SalesOrderLinesV2",
  "dateField": "CreatedDateTime",
  "comparisonType": "YoY",
  "aggregations": [{"function": "SUM", "field": "LineAmount"}]
}
```

> **You:** How did Q4 sales compare to Q3?

Claude will use `compare_periods` with QoQ comparison:
```json
{
  "entity": "SalesOrderLinesV2",
  "dateField": "CreatedDateTime",
  "comparisonType": "QoQ",
  "aggregations": [{"function": "SUM", "field": "LineAmount"}]
}
```

### Customer Intelligence

> **You:** Give me a complete analysis of customer US-001 - profile, orders, spend, and trends

Claude will use `analyze_customer` for comprehensive single-call analysis:
```json
{
  "customerAccount": "US-001",
  "includeOrders": true,
  "includeSpend": true,
  "includeTrending": true
}
```

> **You:** Find the customer named "S&S Industries"

Claude will use `search_entity` which handles special characters that break standard OData:
```json
{
  "entity": "CustomersV3",
  "searchTerm": "S&S Industries",
  "searchField": "CustomerName"
}
```

### Multi-Query & Joins

> **You:** Get me a dashboard view: total customers, total orders this month, and top 5 products by sales

Claude will use `batch_query` to run all three queries in parallel:
```json
{
  "queries": [
    {"name": "total_customers", "entity": "CustomersV3", "top": 1},
    {"name": "orders_this_month", "entity": "SalesOrderHeadersV2", "filter": "OrderCreatedDateTime ge 2024-01-01"},
    {"name": "top_products", "entity": "SalesOrderLinesV2", "top": 5, "orderby": "LineAmount desc"}
  ]
}
```

> **You:** Show me recent orders with customer names and their customer groups

Claude will use `join_entities` to correlate orders with customer details:
```json
{
  "primaryEntity": "SalesOrderHeadersV2",
  "primaryKey": "OrderingCustomerAccountNumber",
  "secondaryEntity": "CustomersV3",
  "secondaryKey": "CustomerAccount",
  "primarySelect": ["SalesOrderNumber", "OrderCreatedDateTime"],
  "secondarySelect": ["CustomerName", "CustomerGroup"]
}
```

### Data Export

> **You:** Export all customers with credit limit over $100K to CSV

Claude will use `export` with format and filter:
```json
{
  "entity": "CustomersV3",
  "format": "csv",
  "filter": "CreditLimit gt 100000",
  "select": ["CustomerAccount", "CustomerName", "CreditLimit"]
}
```

### Understanding Enums

> **You:** What are the possible values for sales order status?

Claude will check the `d365://enums` resource or use `execute_code` with `d365.getEnum('SalesOrderStatus')`.

### Complex Custom Analysis

> **You:** Compare the average credit limits between US and EU customer groups

For complex logic that doesn't fit built-in tools, Claude will use `execute_code`:
```javascript
const customers = await d365.query('CustomersV3', {
  $filter: "CustomerGroup eq 'US' or CustomerGroup eq 'EU'",
  $select: 'CustomerGroup,CreditLimit'
});

const groups = { US: [], EU: [] };
for (const c of customers) {
  if (groups[c.CustomerGroup]) {
    groups[c.CustomerGroup].push(c.CreditLimit || 0);
  }
}

const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

return {
  US: { count: groups.US.length, avgCreditLimit: avg(groups.US) },
  EU: { count: groups.EU.length, avgCreditLimit: avg(groups.EU) }
};
```

## Tips for Best Results

1. **Ask business questions directly** - The MCP tools handle complexity for you. Just ask: "Who are our top 20 customers by spend?" or "How did Q4 compare to Q3?"

2. **Use natural date formats** - Claude understands "last month", "Q4 2024", "past 12 months", or specific dates like "January 1, 2024"

3. **Don't worry about special characters** - Searching for "S&S Industries" or "O'Brien Corp" works automatically. The tools have fallback strategies for characters that break standard OData.

4. **Request trends and comparisons** - Built-in time intelligence handles the complexity: "Show monthly sales trend with growth rates" or "Compare this year's revenue to last year"

5. **Combine multiple questions** - Ask for dashboard-style views: "Get me total customers, orders this month, and top 5 products" - queries run in parallel.

6. **Export data when needed** - Request CSV, JSON, or TSV exports directly: "Export all customers with credit limit over $100K to CSV"

7. **Ask for explanations** - If you want to learn OData syntax, ask Claude to explain the query: "Show customers in group US and explain the OData query"

## API Reference

### Resources

#### `d365://entities`

List available D365 entities with optional filtering.

**Query Parameters:**
- `filter` (optional): Wildcard pattern (`*` for any chars, `?` for single char)

**Examples:**
```
d365://entities                    # List all entities
d365://entities?filter=Cust*       # Entities starting with "Cust"
d365://entities?filter=*Header*    # Entities containing "Header"
```

#### `d365://entity/{entityName}`

Get the full schema for an entity.

**Examples:**
```
d365://entity/CustomersV3
d365://entity/SalesOrderHeaders
```

**Response includes:**
- Entity name and description
- Primary key fields
- All fields with types, constraints, and enum references
- Navigation properties (relationships)

#### `d365://enums`

List all enum type definitions.

**Response includes:**
- Enum name and full namespace
- All member values with their numeric codes

### Tools

#### `describe_entity`

Get entity schema in a human-readable format.

**Parameters:**
- `entity` (string, required): Entity name

**Example:**
```json
{
  "entity": "CustomersV3"
}
```

#### `execute_odata`

Execute a raw OData path against D365.

**Parameters:**
- `path` (string, required): OData path appended to `/data/`

**Examples:**
```json
// Query with parameters
{ "path": "CustomersV3?$top=5&$select=CustomerAccount,CustomerName" }

// Single record by key
{ "path": "CustomersV3('US-001')" }

// Compound key
{ "path": "CustomersV3(DataAreaId='usmf',CustomerAccount='US-001')" }

// Count
{ "path": "CustomersV3/$count" }

// Filtered count
{ "path": "CustomersV3/$count?$filter=CustomerGroup eq 'US'" }

// With expansion
{ "path": "SalesOrderHeaders?$expand=SalesOrderLines&$top=3" }
```

#### `execute_code`

Run JavaScript code in a secure sandbox with D365 API access.

**Parameters:**
- `code` (string, required): JavaScript code to execute
- `description` (string, optional): Description of what the code does

**Sandbox Environment:**
- 128MB memory limit
- 30 second timeout
- No file system or network access (except D365 API)
- `console.log/warn/error` captured in output

**Available APIs:**

```javascript
// Query records
const customers = await d365.query('CustomersV3', {
  $filter: "CustomerGroup eq 'US'",
  $select: 'CustomerAccount,CustomerName',
  $top: 10
});

// Get single record
const customer = await d365.get('CustomersV3', 'US-001');
// Or with compound key:
const customer = await d365.get('CustomersV3', {
  DataAreaId: 'usmf',
  CustomerAccount: 'US-001'
});

// Count records
const count = await d365.count('CustomersV3');
const filtered = await d365.count('CustomersV3', "CustomerGroup eq 'US'");

// Get entity schema
const schema = await d365.describe('CustomersV3');

// Get enum definition
const statusEnum = await d365.getEnum('SalesStatus');

// Raw OData request
const result = await d365.odata('CustomersV3?$top=5');
```

**Example - Complex Aggregation:**

```javascript
// Count customers by group
const customers = await d365.query('CustomersV3', {
  $select: 'CustomerGroup'
});

const counts = {};
for (const c of customers) {
  counts[c.CustomerGroup] = (counts[c.CustomerGroup] || 0) + 1;
}

return counts;
```

#### `aggregate`

Perform aggregations on D365 entity data. Uses fast `/$count` for simple COUNT operations, client-side aggregation otherwise.

**Parameters:**
- `entity` (string, required): Entity name to aggregate
- `aggregations` (array, required): Array of aggregation specs:
  - `function`: "SUM" | "AVG" | "COUNT" | "MIN" | "MAX" | "COUNTDISTINCT" | "P50" | "P90" | "P95" | "P99"
  - `field`: Field to aggregate (use "*" for COUNT)
  - `alias` (optional): Custom result name
- `filter` (string, optional): OData $filter expression
- `groupBy` (array, optional): Fields to group by
- `accurate` (boolean, optional): Fetch ALL records for exact totals (default: false)
- `sampling` (boolean, optional): Use statistical sampling for fast estimates on very large datasets (default: false)
- `orderBy` (string, optional): Sort results by aggregation alias (e.g., "sum_LineAmount desc")
- `top` (number, optional): Return only top N results after sorting

**Percentile functions:**
- `P50` - Median (50th percentile)
- `P90` - 90th percentile
- `P95` - 95th percentile
- `P99` - 99th percentile

**Performance notes:**
- Default mode caps at 5K records for quick estimates
- `accurate=true` fetches ALL records with 60s timeout per page and automatic retry (2 retries with exponential backoff)
- `sampling=true` uses ~10K record sample for statistical estimates on very large datasets (100K+ records)

**Examples:**
```json
// Count all customers
{ "entity": "CustomersV3", "aggregations": [{"function": "COUNT", "field": "*"}] }

// Sum with filter
{ "entity": "SalesOrderLines", "aggregations": [{"function": "SUM", "field": "LineAmount"}], "filter": "SalesOrderNumber eq 'SO-001'" }

// Accurate mode for exact totals
{ "entity": "SalesOrderLines", "aggregations": [{"function": "SUM", "field": "LineAmount"}], "accurate": true }

// Group by
{ "entity": "SalesOrderLines", "aggregations": [{"function": "SUM", "field": "LineAmount"}], "groupBy": ["ItemNumber"] }

// Median order value (requires accurate=true for percentiles)
{ "entity": "SalesOrderLines", "aggregations": [{"function": "P50", "field": "LineAmount"}], "accurate": true }

// Fast estimate on very large dataset (100K+ records)
{ "entity": "BatchJobs", "aggregations": [{"function": "COUNT", "field": "*"}], "sampling": true }

// Top 20 customers by spend
{ "entity": "SalesOrderLines", "aggregations": [{"function": "SUM", "field": "LineAmount"}], "groupBy": ["CustomerAccount"], "orderBy": "sum_LineAmount desc", "top": 20 }
```

#### `get_related`

Follow entity relationships to retrieve related records in a single call.

**Parameters:**
- `entity` (string, required): Source entity name
- `key` (string | object, required): Primary key of source record
- `relationship` (string, required): Navigation property name to follow
- `select` (string[], optional): Fields to include from related entity
- `filter` (string, optional): Filter to apply to related records
- `top` (number, optional): Maximum related records (default: 1000)

**Examples:**
```json
// Get order lines for an order
{ "entity": "SalesOrderHeaders", "key": "SO-001", "relationship": "SalesOrderLines" }

// With compound key
{ "entity": "SalesOrderHeaders", "key": {"DataAreaId": "usmf", "SalesOrderNumber": "SO-001"}, "relationship": "SalesOrderLines" }

// With field selection and filter
{ "entity": "SalesOrderHeaders", "key": "SO-001", "relationship": "SalesOrderLines", "select": ["ItemNumber", "LineAmount"], "filter": "LineAmount gt 1000" }
```

#### `export`

Export D365 entity data to CSV, JSON, or TSV format.

**Parameters:**
- `entity` (string, required): Entity to export
- `format` ("json" | "csv" | "tsv", optional): Output format (default: "json")
- `select` (string[], optional): Fields to include
- `filter` (string, optional): OData $filter expression
- `orderBy` (string, optional): OData $orderby expression
- `maxRecords` (number, optional): Maximum records (default: 10000)
- `includeHeaders` (boolean, optional): Include header row for CSV/TSV (default: true)

**Examples:**
```json
// JSON export with field selection
{ "entity": "CustomersV3", "format": "json", "select": ["CustomerAccount", "CustomerName"] }

// CSV export with filter
{ "entity": "SalesOrderLines", "format": "csv", "filter": "SalesOrderNumber eq 'SO-001'" }

// TSV with ordering and limit
{ "entity": "Products", "format": "tsv", "orderBy": "ProductName asc", "maxRecords": 500 }
```

#### `compare_periods`

Compare aggregations between two time periods (YoY, QoQ, MoM, or custom ranges).

**Parameters:**
- `entity` (string, required): Entity to analyze
- `dateField` (string, required): Date/datetime field for filtering
- `aggregations` (array, required): Same as aggregate tool
- `comparisonType` ("YoY" | "QoQ" | "MoM" | "custom", required): Type of comparison
- `referenceDate` (string, optional): Reference date for calculations (default: today)
- `period1`, `period2` (objects, optional): Custom period ranges
- `filter` (string, optional): Additional OData filter
- `groupBy` (string[], optional): Fields to group by

**Examples:**
```json
// Year-over-Year comparison
{ "entity": "SalesOrderLines", "dateField": "CreatedDateTime", "comparisonType": "YoY", "aggregations": [{"function": "SUM", "field": "LineAmount"}] }

// Month-over-Month with grouping
{ "entity": "SalesOrderLines", "dateField": "CreatedDateTime", "comparisonType": "MoM", "aggregations": [{"function": "COUNT", "field": "*"}], "groupBy": ["ItemGroup"] }

// Custom date ranges
{ "entity": "SalesOrderLines", "dateField": "CreatedDateTime", "comparisonType": "custom", "aggregations": [{"function": "SUM", "field": "LineAmount"}], "period1": {"start": "2024-01-01", "end": "2024-03-31"}, "period2": {"start": "2023-01-01", "end": "2023-03-31"} }
```

#### `trending`

Time series analysis with aggregation, growth rates, and moving averages.

**Parameters:**
- `entity` (string, required): Entity to analyze
- `dateField` (string, required): Date/datetime field for bucketing
- `valueField` (string, required): Numeric field to aggregate
- `aggregation` ("SUM" | "AVG" | "COUNT" | "MIN" | "MAX", optional): Default: "SUM"
- `granularity` ("day" | "week" | "month" | "quarter" | "year", optional): Default: "month"
- `periods` (number, optional): Number of periods to analyze (default: 12)
- `endDate` (string, optional): End date for analysis (default: today)
- `filter` (string, optional): Additional OData filter
- `movingAverageWindow` (number, optional): Window size for MA calculation
- `includeGrowthRate` (boolean, optional): Include growth rates (default: true)

**Examples:**
```json
// Monthly revenue trend
{ "entity": "SalesOrderLines", "dateField": "CreatedDateTime", "valueField": "LineAmount", "granularity": "month", "periods": 12 }

// Weekly order count with moving average
{ "entity": "SalesOrderHeaders", "dateField": "OrderDate", "valueField": "*", "aggregation": "COUNT", "granularity": "week", "movingAverageWindow": 4 }

// Quarterly with filter
{ "entity": "SalesOrderLines", "dateField": "CreatedDateTime", "valueField": "LineAmount", "granularity": "quarter", "filter": "ItemGroup eq 'Electronics'" }
```

#### `save_query`

Save a reusable query template for later execution. Use `{{paramName}}` for substitutable parameters.

**Parameters:**
- `name` (string, required): Unique name for the query
- `description` (string, optional): Description of the query
- `entity` (string, required): Entity to query
- `select` (string[], optional): Fields to select
- `filter` (string, optional): OData $filter (use `{{paramName}}` for parameters)
- `orderBy` (string, optional): OData $orderby expression
- `top` (number, optional): Maximum records
- `expand` (string, optional): OData $expand expression

**Examples:**
```json
// Basic query
{ "name": "active_customers", "entity": "CustomersV3", "filter": "IsActive eq true" }

// With parameters
{ "name": "customer_orders", "entity": "SalesOrderHeaders", "filter": "CustomerAccount eq '{{customerId}}'" }

// Complex query with description
{ "name": "recent_sales", "description": "Recent sales for analysis", "entity": "SalesOrderLines", "select": ["ItemNumber", "LineAmount"], "filter": "CreatedDateTime ge {{startDate}}", "orderBy": "CreatedDateTime desc", "top": 100 }
```

#### `execute_saved_query`

Execute a previously saved query template.

**Parameters:**
- `name` (string, required): Name of the saved query
- `params` (object, optional): Parameter values to substitute
- `fetchAll` (boolean, optional): Fetch all pages (default: false)
- `maxRecords` (number, optional): Max records when fetchAll=true (default: 50000)

**Examples:**
```json
// Simple execution
{ "name": "active_customers" }

// With parameters
{ "name": "customer_orders", "params": {"customerId": "US-001"} }

// Multiple parameters with pagination
{ "name": "date_range_sales", "params": {"startDate": "2024-01-01", "endDate": "2024-12-31"}, "fetchAll": true }
```

#### `delete_saved_query`

Delete a saved query template.

**Parameters:**
- `name` (string, required): Name of the query to delete

#### `join_entities`

Cross-entity joins using OData $expand or client-side join.

**Parameters:**
- `primaryEntity` (string, required): Primary entity name
- `primaryKey` (string, required): Primary key field to join on
- `secondaryEntity` (string, required): Secondary entity name
- `secondaryKey` (string, required): Secondary key field to join on
- `primarySelect` (string[], optional): Fields from primary entity
- `secondarySelect` (string[], optional): Fields from secondary entity
- `primaryFilter` (string, optional): Filter for primary entity
- `joinType` ("inner" | "left", optional): Join type (default: "inner")
- `maxRecords` (number, optional): Maximum records (default: 5000)

**Examples:**
```json
// Join orders with customers
{ "primaryEntity": "SalesOrderHeadersV2", "primaryKey": "OrderingCustomerAccountNumber", "secondaryEntity": "CustomersV3", "secondaryKey": "CustomerAccount", "primarySelect": ["SalesOrderNumber", "OrderCreatedDateTime"], "secondarySelect": ["CustomerName", "CustomerGroup"] }
```

#### `batch_query`

Execute multiple D365 OData queries in parallel, returning all results in a single response.

**Parameters:**
- `queries` (array, required): Array of query specs (1-10 queries):
  - `name` (string, optional): Label for this query result
  - `entity` (string, required): Entity name
  - `filter` (string, optional): OData $filter expression
  - `select` (string[], optional): Fields to include
  - `top` (number, optional): Limit records (default: 100)
  - `orderby` (string, optional): OData $orderby expression
  - `fetchAll` (boolean, optional): Auto-paginate all pages
  - `maxRecords` (number, optional): Max records when fetchAll=true
- `stopOnError` (boolean, optional): Stop on first failure (default: false)

**Examples:**
```json
// Multiple parallel queries
{
  "queries": [
    { "name": "recent_orders", "entity": "SalesOrderHeadersV2", "top": 10, "orderby": "CreatedDateTime desc" },
    { "name": "customers", "entity": "CustomersV3", "filter": "CustomerGroup eq 'US'", "select": ["CustomerAccount", "CustomerName"] },
    { "name": "all_invoices", "entity": "SalesInvoiceHeadersV2", "fetchAll": true, "maxRecords": 1000 }
  ]
}
```

#### `search_entity`

Robust entity search with automatic fallback strategies. Handles special characters (like `&` in company names) that cause issues with standard OData `contains()`.

**Search Strategies (tried in order):**
1. `contains()` - Standard OData text search (fastest)
2. `startswith()` - Prefix matching (more reliable on D365)
3. `exact` - Exact field match
4. `client_filter` - Fetch + client-side filter (always works)

**Parameters:**
- `entity` (string, required): Entity to search
- `searchTerm` (string, required): Text to search for
- `searchField` (string, required): Field to search in
- `select` (string[], optional): Fields to return in results
- `top` (number, optional): Maximum results (default: 10)

**Examples:**
```json
// Search customers with special characters
{ "entity": "CustomersV3", "searchTerm": "S&S", "searchField": "CustomerName" }

// Search with specific fields
{ "entity": "CustomersV3", "searchTerm": "Contoso", "searchField": "CustomerName", "select": ["CustomerAccount", "CustomerName", "CustomerGroup"], "top": 5 }

// Search vendors
{ "entity": "VendorsV3", "searchTerm": "Microsoft", "searchField": "VendorName" }
```

#### `analyze_customer`

Comprehensive customer analysis in a single call. Runs parallel queries to gather profile, orders, spend, and trending data.

**Features:**
- Customer profile lookup (with fallback search strategies)
- Order statistics (count, total spend, average order value)
- Order date range (first and last order)
- Recent orders list
- Monthly order trending

Uses efficient aggregation at the line level (`SalesOrderLinesV2`) for accurate spend calculation, avoiding the $0 header total issue.

**Parameters:**
- `customerAccount` (string, optional): Customer account number
- `customerName` (string, optional): Customer name to search (handles special characters)
- `includeOrders` (boolean, optional): Include recent orders list (default: true)
- `includeSpend` (boolean, optional): Include total spend calculation (default: true)
- `includeTrending` (boolean, optional): Include monthly trend analysis (default: true)
- `recentOrdersLimit` (number, optional): Number of recent orders to show (default: 10)
- `trendPeriods` (number, optional): Number of months for trend (default: 12)

**Examples:**
```json
// Analyze by account number
{ "customerAccount": "SS0011" }

// Analyze by name (handles special characters like &)
{ "customerName": "S&S" }

// Quick analysis without trending (faster)
{ "customerAccount": "US-001", "includeTrending": false }

// Full analysis with custom periods
{ "customerName": "Contoso", "recentOrdersLimit": 20, "trendPeriods": 24 }
```

**Output includes:**
- Customer profile (name, account, group, address)
- Summary statistics (total orders, total spend, average order value, first/last order dates)
- Recent orders list
- Monthly order trend table with order counts and revenue

#### `d365://queries`

Resource that lists all saved query templates.

**Response includes:**
- Query count and list
- Each query's name, description, entity, and parameters
- Usage instructions

## OData Query Syntax

### Filter Examples

```
// Equality
$filter=CustomerAccount eq 'US-001'

// Comparison
$filter=CreditLimit gt 10000

// String functions
$filter=startswith(CustomerName, 'Contoso')
$filter=contains(CustomerName, 'Inc')

// Logical operators
$filter=CustomerGroup eq 'US' and CreditLimit gt 5000

// Enum values
$filter=Status eq Microsoft.Dynamics.DataEntities.SalesStatus'Invoiced'

// Date comparison
$filter=OrderDate gt 2024-01-01
```

### Select and Expand

```
// Select specific fields
$select=CustomerAccount,CustomerName,CreditLimit

// Expand navigation property
$expand=SalesOrderLines

// Expand with nested select
$expand=SalesOrderLines($select=ItemId,Quantity)
```

### Ordering and Pagination

```
// Sort ascending
$orderby=CustomerName asc

// Sort descending
$orderby=OrderDate desc

// Multiple sort columns
$orderby=CustomerGroup asc,CustomerName asc

// Pagination
$top=50&$skip=100
```

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Run directly (requires environment variables)
npm start
```

## Project Structure

```
src/
├── index.ts              # Entry point and server setup
├── config.ts             # Configuration loading
├── auth.ts               # Azure AD authentication
├── d365-client.ts        # D365 OData API client
├── metadata-cache.ts     # EDMX metadata parser and cache
├── types.ts              # TypeScript type definitions
├── resources/
│   ├── index.ts          # Resource registration
│   ├── entities.ts       # d365://entities resource
│   ├── entity.ts         # d365://entity/{name} resource
│   ├── enums.ts          # d365://enums resource
│   └── queries.ts        # d365://queries resource
├── sandbox/
│   ├── index.ts          # SandboxManager (isolated-vm)
│   ├── d365-api.ts       # D365 API bindings for sandbox
│   └── types.ts          # Sandbox type definitions
├── utils/
│   ├── date-utils.ts     # Date period calculations
│   └── csv-utils.ts      # CSV/TSV formatting
└── tools/
    ├── index.ts          # Tool registration
    ├── describe-entity.ts
    ├── execute-odata.ts
    ├── execute-code.ts
    ├── aggregate.ts
    ├── get-related.ts    # Relationship navigation
    ├── export.ts         # CSV/JSON/TSV export
    ├── compare-periods.ts # Period comparisons
    ├── trending.ts       # Time series analysis
    ├── saved-queries.ts  # Query templates
    ├── join-entities.ts  # Cross-entity joins
    ├── batch-query.ts    # Parallel query execution
    ├── search-entity.ts  # Robust entity search
    └── analyze-customer.ts # Customer analysis
```

## Security Considerations

- **Read-only access**: This server only supports read operations
- **Sandboxed execution**: JavaScript runs in isolated-vm with strict memory and time limits
- **No credential exposure**: Credentials are managed server-side
- **OData injection prevention**: Parameters are properly encoded

## Troubleshooting

### Authentication Errors

- Verify tenant ID, client ID, and secret are correct
- Ensure the Azure AD app has the required API permissions
- Check that admin consent has been granted

### Entity Not Found

- Use `d365://entities` to discover available entities
- Entity names are case-sensitive
- Some entities may not be exposed via OData

### Timeout Errors

- Reduce query scope with `$top` and `$filter`
- For large datasets, use pagination with `$skip`
- In sandbox code, break up operations into smaller batches

**Large dataset aggregation improvements:**
- Pagination requests now use 60s timeout with automatic retry (2 retries with exponential backoff)
- Configure timeout via `D365_PAGINATION_TIMEOUT_MS` environment variable
- For very large datasets (100K+ records), use `sampling=true` on the `aggregate` tool for fast statistical estimates
- `accurate=true` mode now reports partial results if interrupted mid-pagination

## License

MIT
