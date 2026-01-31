# D365 Finance & Operations MCP Server

An MCP (Model Context Protocol) server that provides access to Microsoft Dynamics 365 Finance & Operations environments. Enables AI assistants like Claude to explore D365 metadata, query data, and perform write operations on non-production environments.

## Features

- **Multi-Environment Support** - Connect to multiple D365 environments (production, UAT, dev)
- **Read/Write Operations** - Query data on all environments; create, update, delete on non-production only
- **Production Safety** - Production environments are always read-only by design
- **MCP Resources** for schema discovery and metadata exploration
- **20+ Specialized Tools** for flexible data access, aggregation, and analysis
- **Environment Dashboard** - Health monitoring, API statistics, and operation tracking
- **Secure Authentication** via Azure AD client credentials
- **Automatic Metadata Caching** (24-hour TTL, per-environment)

## Architecture

### Resources

| Resource | URI | Purpose |
|----------|-----|---------|
| Entities List | `d365://entities?filter=<pattern>` | List all entities with optional wildcard filtering |
| Entity Schema | `d365://entity/{entityName}` | Full schema for any entity (fields, keys, navigation properties) |
| Navigation Properties | `d365://navigation/{entityName}` | Entity relationships and navigation properties |
| Enum Definitions | `d365://enums` | All enum types with their values |
| Saved Queries | `d365://queries` | List saved query templates |
| Dashboard | `d365://dashboard` | JSON metrics for all environments (health, API stats, recent operations) |

### Tools

All tools support an optional `environment` parameter to target specific D365 environments.

| Tool | Purpose |
|------|---------|
| `list_environments` | List all configured D365 environments with connection status |
| `set_environment` | Set the working environment for the current session |
| `describe_entity` | Quick schema lookup for an entity |
| `execute_odata` | Execute raw OData paths (queries, single records, counts) |
| `aggregate` | Perform aggregations (SUM, AVG, COUNT, MIN, MAX, COUNTDISTINCT, percentiles) on entity data |
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
| `create_record` | Create new records (non-production environments only) |
| `update_record` | Update existing records (non-production environments only) |
| `delete_record` | Delete records (non-production environments only) |
| `dashboard` | Display environment dashboard with health status, API statistics, and recent operations |

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

## Quick Start (Recommended)

Run the interactive setup wizard:

```bash
npm run setup
```

The wizard will:
1. Check prerequisites (Node.js 18+, dependencies)
2. Guide you through D365 environment configuration
3. Test connectivity to your D365 environments
4. Generate configuration files
5. Configure Claude Desktop and/or Claude Code

After setup, restart Claude Desktop (Cmd+Q then reopen on macOS, or Ctrl+Q on Windows) or start a new Claude Code session.

## Configuration

### Multi-Environment Configuration (Recommended)

Create a `d365-environments.json` file in the project root or working directory:

```json
{
  "environments": [
    {
      "name": "production",
      "displayName": "Production",
      "type": "production",
      "tenantId": "your-tenant-id",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret",
      "environmentUrl": "https://your-company.operations.dynamics.com",
      "default": true
    },
    {
      "name": "uat",
      "displayName": "UAT (Tier 2)",
      "type": "non-production",
      "tenantId": "your-tenant-id",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret",
      "environmentUrl": "https://your-company-uat.sandbox.operations.dynamics.com"
    },
    {
      "name": "dev",
      "displayName": "Dev Sandbox",
      "type": "non-production",
      "tenantId": "your-tenant-id",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret",
      "environmentUrl": "https://your-company-dev.sandbox.operations.dynamics.com"
    }
  ]
}
```

**Environment Types:**
- `type: "production"` - Read-only access (all write operations are blocked)
- `type: "non-production"` - Full read/write access (create, update, delete enabled)

Copy `d365-environments.example.json` as a starting point.

### Single Environment (Legacy)

The server also supports the following environment variables (fallback if no JSON config):

| Variable | Description |
|----------|-------------|
| `D365_TENANT_ID` | Azure AD tenant ID |
| `D365_CLIENT_ID` | Azure AD application (client) ID |
| `D365_CLIENT_SECRET` | Azure AD client secret |
| `D365_ENVIRONMENT_URL` | D365 F&O environment URL (e.g., `https://contoso.operations.dynamics.com`) |
| `D365_ENVIRONMENT_TYPE` | Optional: "production" or "non-production" (defaults to "production" for safety) |

Optional:
| Variable | Default | Description |
|----------|---------|-------------|
| `D365_TRANSPORT` | `stdio` | Transport mode (`stdio` or `http`) |
| `D365_HTTP_PORT` | `3000` | HTTP port (when using http transport) |
| `D365_LOG_LEVEL` | `info` | Logging level |
| `D365_PAGINATION_TIMEOUT_MS` | `60000` | Timeout (ms) for paginated requests on large datasets |
| `D365_CONFIG_FILE` | | Path to config file if not in default location |

### Azure AD App Registration

#### Step 1: Create Azure AD App

1. Go to [Azure Portal](https://portal.azure.com) > Azure Active Directory > App registrations
2. Click "New registration"
3. Name it (e.g., "D365 MCP Server")
4. Select "Accounts in this organizational directory only"
5. Click Register

#### Step 2: Configure API Permissions

1. Go to "API permissions" > "Add a permission"
2. Select "Dynamics 365 Finance and Operations"
3. Choose "Application permissions" > `CustomService.ReadWrite.All`
4. Click "Grant admin consent for [your organization]"

#### Step 3: Create Client Secret

1. Go to "Certificates & secrets" > "New client secret"
2. Add a description and expiry period
3. Copy the secret value immediately (shown only once)
4. Note down:
   - **Tenant ID**: Found on the Overview page
   - **Client ID**: Application (client) ID on Overview page
   - **Client Secret**: The value you just copied

#### Step 4: Register App in D365 Environments

**Important:** This step must be done in each D365 environment (Production, UAT, Dev) you want to connect to.

1. In D365 F&O, navigate to:
   **System Administration > Setup > Azure Active Directory applications**

2. Click "New" to add a record:
   | Field | Value |
   |-------|-------|
   | Client ID | The Application (client) ID from Azure AD |
   | Name | Descriptive name (e.g., "MCP Server Integration") |
   | User ID | A D365 user account for the app to run as |

3. The **User ID** determines what data the app can access:
   - Use a service account with appropriate security roles
   - For read-only access: assign roles like "View all data"
   - For write access on non-production: assign roles that allow create/update/delete

4. Repeat for each environment you want to connect to

> **Note:** If you skip this step, API calls will fail with 401 Unauthorized or 403 Forbidden errors even though Azure AD authentication succeeded.

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

### Environment Visibility Configuration

When using multiple D365 environments, you can configure how they appear in Claude:

#### Option A: Separate Servers per Environment (Recommended)

This option shows each environment as a separate MCP server in Claude's sidebar:

```json
{
  "mcpServers": {
    "D365-production": {
      "command": "node",
      "args": ["/path/to/d365fo-mcp-server/dist/index.js"],
      "env": {
        "D365_CONFIG_FILE": "/path/to/d365fo-mcp-server/d365-environments.json",
        "D365_SINGLE_ENV": "production"
      }
    },
    "D365-uat": {
      "command": "node",
      "args": ["/path/to/d365fo-mcp-server/dist/index.js"],
      "env": {
        "D365_CONFIG_FILE": "/path/to/d365fo-mcp-server/d365-environments.json",
        "D365_SINGLE_ENV": "uat"
      }
    },
    "D365-dev": {
      "command": "node",
      "args": ["/path/to/d365fo-mcp-server/dist/index.js"],
      "env": {
        "D365_CONFIG_FILE": "/path/to/d365fo-mcp-server/d365-environments.json",
        "D365_SINGLE_ENV": "dev"
      }
    }
  }
}
```

**Pros:**
- Environment is immediately visible in Claude's sidebar
- No ambiguity about which environment a query targets
- Works reliably across all platforms

**How it works:** The `D365_SINGLE_ENV` environment variable tells the server to load only that specific environment from `d365-environments.json`. The `D365_CONFIG_FILE` ensures the config is found regardless of working directory.

#### Option B: Single Multi-Environment Server

Use a single server with an `environment` parameter on each query:

```json
{
  "mcpServers": {
    "d365": {
      "command": "node",
      "args": ["/path/to/d365fo-mcp-server/dist/index.js"],
      "env": {
        "D365_CONFIG_FILE": "/path/to/d365fo-mcp-server/d365-environments.json"
      }
    }
  }
}
```

Then specify the environment in queries:
```json
{ "entity": "CustomersV3", "top": 10, "environment": "uat" }
```

**Pros:**
- Single server process
- Flexibility to query any environment in one session

The interactive setup script (`node setup.js`) can generate either configuration for you.

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

Claude will check the `d365://enums` resource to find enum definitions.

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

#### `d365://navigation/{entityName}`

Get navigation properties (relationships) for an entity.

**Examples:**
```
d365://navigation/SalesOrderHeadersV2
d365://navigation/CustomersV3
```

**Response includes:**
- Navigation property names
- Target entity types
- Relationship cardinality (one-to-many, many-to-one)

#### `d365://enums`

List all enum type definitions.

**Response includes:**
- Enum name and full namespace
- All member values with their numeric codes

### Tools

#### `list_environments`

List all configured D365 environments with their connection status and permissions.

**Parameters:**
- None required

**Example:**
```json
{}
```

**Response includes:**
- Environment name and display name
- Type (production/non-production)
- Connection status
- Read/write permissions

#### `set_environment`

Set the working environment for the current session. Subsequent tool calls will use this environment by default.

**Parameters:**
- `environment` (string, required): Name of the environment to set as active

**Example:**
```json
{
  "environment": "uat"
}
```

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

#### `dashboard`

Display environment dashboard with health status, API statistics, and recent operations.

**Parameters:**
- `checkHealth` (boolean, optional): Perform live connectivity check (default: false)

**Example:**
```json
{
  "checkHealth": true
}
```

**Response includes:**
- Per-environment health status
- API call statistics (total calls, success rate)
- Recent operations log
- Environment configuration summary

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
├── index.ts                # Entry point and server setup
├── config-loader.ts        # Configuration loading (JSON + env var fallback)
├── environment-manager.ts  # Multi-environment management and write guards
├── auth.ts                 # Azure AD OAuth2 authentication
├── d365-client.ts          # D365 OData API client with read/write methods
├── metadata-cache.ts       # EDMX metadata parser and cache (24h TTL)
├── progress.ts             # Progress reporting for long operations
├── types.ts                # TypeScript type definitions
├── metrics/
│   ├── index.ts            # Metrics module exports
│   ├── metrics-tracker.ts  # API call statistics tracking
│   ├── health-checker.ts   # Environment connectivity health checks
│   └── operation-log.ts    # Operation history tracking
├── resources/
│   ├── index.ts            # Resource registration
│   ├── entities.ts         # d365://entities resource
│   ├── entity.ts           # d365://entity/{name} resource
│   ├── navigation.ts       # d365://navigation/{name} resource
│   ├── enums.ts            # d365://enums resource
│   ├── queries.ts          # d365://queries resource
│   └── dashboard.ts        # d365://dashboard resource
├── utils/
│   ├── date-utils.ts       # Date period calculations
│   └── csv-utils.ts        # CSV/TSV formatting
└── tools/
    ├── index.ts            # Tool registration
    ├── common.ts           # Shared tool utilities
    ├── list-environments.ts
    ├── set-environment.ts
    ├── describe-entity.ts
    ├── execute-odata.ts
    ├── aggregate.ts
    ├── get-related.ts
    ├── export.ts
    ├── compare-periods.ts
    ├── trending.ts
    ├── saved-queries.ts    # save/execute/delete query templates
    ├── join-entities.ts
    ├── batch-query.ts
    ├── search-entity.ts
    ├── analyze-customer.ts
    ├── create-record.ts    # Write operation (non-production only)
    ├── update-record.ts    # Write operation (non-production only)
    ├── delete-record.ts    # Write operation (non-production only)
    └── dashboard.ts
```

## Write Operations (Non-Production Only)

Write operations are only available on environments with `type: "non-production"`. Production environments are always read-only.

### `create_record`

Create a new record in a D365 entity.

**Parameters:**
- `entity` (string, required): Entity name
- `data` (object, required): Field values for the new record
- `environment` (string, optional): Target environment

**Example:**
```json
{
  "entity": "CustomersV3",
  "data": {
    "CustomerAccount": "CUST-001",
    "CustomerName": "Contoso Ltd",
    "CustomerGroup": "US"
  },
  "environment": "uat"
}
```

### `update_record`

Update an existing record.

**Parameters:**
- `entity` (string, required): Entity name
- `key` (string | object, required): Record key
- `data` (object, required): Field values to update
- `etag` (string, optional): ETag for optimistic concurrency
- `environment` (string, optional): Target environment

**Example:**
```json
{
  "entity": "CustomersV3",
  "key": "CUST-001",
  "data": {
    "CustomerName": "Contoso Corporation"
  },
  "environment": "dev"
}
```

### `delete_record`

Delete a record from an entity.

**Parameters:**
- `entity` (string, required): Entity name
- `key` (string | object, required): Record key
- `etag` (string, optional): ETag for optimistic concurrency
- `environment` (string, optional): Target environment

**Example:**
```json
{
  "entity": "CustomersV3",
  "key": "CUST-001",
  "environment": "dev"
}
```

## Security

### Credential Protection

This project implements multiple layers to protect your Azure AD credentials:

| Protection | Description |
|------------|-------------|
| `.gitignore` | `.env` and `d365-environments.json` are excluded from version control |
| `.gitattributes` | Sensitive files excluded from `git archive` exports |
| Pre-commit hook | Scans staged files for secret patterns before allowing commits |
| Sanitized errors | Azure AD error responses are logged internally but not exposed to callers |

### Protected Files

The following files contain credentials and are protected:

- `.env` - Environment variables (legacy single-environment config)
- `d365-environments.json` - Multi-environment configuration with secrets
- `*.local.json` - Local configuration overrides

**Safe files** (contain placeholders, OK to commit):
- `.env.example` - Template with placeholder values
- `d365-environments.example.json` - Example configuration

### If Credentials Are Exposed

If you accidentally commit or expose credentials:

1. **Immediately rotate the Azure AD client secret:**
   - Go to [Azure Portal](https://portal.azure.com) > Azure Active Directory > App registrations
   - Select your D365 app registration
   - Go to "Certificates & secrets"
   - Create a new client secret
   - Update your local `.env` or `d365-environments.json` with the new secret
   - Delete the old secret from Azure AD

2. **Review Azure AD sign-in logs:**
   - Check for unauthorized access attempts
   - Azure Portal > Azure AD > Sign-in logs > Filter by your app

3. **If committed to git:**
   - Even if you remove the secret in a new commit, it remains in git history
   - Consider using `git filter-branch` or BFG Repo-Cleaner to purge history
   - Force-push the cleaned repository (coordinate with collaborators)

### Rotating Azure AD Secrets

Best practice is to rotate secrets periodically (every 90-180 days):

1. **Create new secret in Azure Portal** (before the old one expires)
2. **Update your configuration files:**
   ```bash
   # Edit .env or d365-environments.json with new secret
   ```
3. **Test connectivity:**
   ```bash
   npm start  # Verify authentication works
   ```
4. **Delete old secret from Azure Portal**

### Pre-commit Hook

The pre-commit hook scans for patterns like:
- Azure AD client secrets (30+ character strings after `clientSecret`)
- Tenant IDs (UUID format after `tenantId`)
- Environment variable assignments with secrets

To bypass (for false positives only):
```bash
git commit --no-verify
```

### Runtime Protections

- **Production environments read-only**: Write operations are structurally blocked on production
- **Non-production write access**: Create, update, delete only available on `type: "non-production"` environments
- **No credential exposure**: Credentials are managed server-side
- **OData injection prevention**: Parameters are properly encoded

## Troubleshooting

### MCP Servers Not Appearing

1. **Restart Claude Desktop fully** - Cmd+Q on macOS (not just close window), then reopen. On Windows, use Ctrl+Q or exit from the system tray.

2. **Check server configuration** - Verify the config file path is correct:
   ```bash
   D365_CONFIG_FILE=./d365-environments.json D365_SINGLE_ENV=uat node dist/index.js
   ```

3. **Verify config path** - Ensure `D365_CONFIG_FILE` in your Claude config points to the actual location of `d365-environments.json`.

4. **Check Claude logs** - On macOS: `~/Library/Logs/Claude/`; on Windows: `%APPDATA%\Claude\logs\`

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
- Use `batch_query` to run multiple queries in parallel

**Large dataset aggregation improvements:**
- Pagination requests now use 60s timeout with automatic retry (2 retries with exponential backoff)
- Configure timeout via `D365_PAGINATION_TIMEOUT_MS` environment variable
- For very large datasets (100K+ records), use `sampling=true` on the `aggregate` tool for fast statistical estimates
- `accurate=true` mode now reports partial results if interrupted mid-pagination

## License

MIT
