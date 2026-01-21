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

### Tools

| Tool | Purpose |
|------|---------|
| `describe_entity` | Quick schema lookup for an entity |
| `execute_odata` | Execute raw OData paths (queries, single records, counts) |
| `execute_code` | Run JavaScript in a secure sandbox with D365 API access |
| `aggregate` | Perform aggregations (SUM, AVG, COUNT, MIN, MAX) on entity data |

## Installation

```bash
# Clone the repository
git clone <repository-url>
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
    "d365": {
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
    "d365": {
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

Once configured, you can ask Claude natural language questions about your D365 environment. Here are some examples:

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

### Complex Analysis

> **You:** Analyze the distribution of customers across different customer groups

Claude will use `execute_code` to run:
```javascript
const customers = await d365.query('CustomersV3', { $select: 'CustomerGroup' });
const distribution = {};
for (const c of customers) {
  distribution[c.CustomerGroup] = (distribution[c.CustomerGroup] || 0) + 1;
}
return distribution;
```

> **You:** Get me all open sales orders with their line items for customer US-001

Claude will use `execute_odata` with expansion:
```
SalesOrderHeaders?$filter=CustomerAccount eq 'US-001' and SalesOrderStatus eq Microsoft.Dynamics.DataEntities.SalesOrderStatus'Open'&$expand=SalesOrderLines
```

### Understanding Enums

> **You:** What are the possible values for sales order status?

Claude will check the `d365://enums` resource or use `execute_code` with `d365.getEnum('SalesOrderStatus')`.

### Multi-Step Analysis

> **You:** Compare the average credit limits between US and EU customer groups

Claude will write and execute sandbox code:
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

1. **Be specific about entities** - D365 has many similarly named entities (e.g., `Customers`, `CustomersV3`, `CustCustomerV3`). Ask Claude to list available entities if unsure.

2. **Mention field names** - If you know the field names, include them: "Get CustomerAccount and CustomerName from CustomersV3"

3. **Use natural date formats** - "Orders from last month" or "Orders after January 1, 2024"

4. **Ask for counts first** - Before fetching large datasets, ask "How many records are in X?" to understand the data volume.

5. **Request explanations** - Ask Claude to explain what query it's running: "Show me customers in group US and explain the OData query you're using"

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
  - `function`: "SUM" | "AVG" | "COUNT" | "MIN" | "MAX" | "COUNTDISTINCT"
  - `field`: Field to aggregate (use "*" for COUNT)
  - `alias` (optional): Custom result name
- `filter` (string, optional): OData $filter expression
- `groupBy` (array, optional): Fields to group by
- `accurate` (boolean, optional): Fetch ALL records for exact totals (default: false)

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
```

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
│   └── enums.ts          # d365://enums resource
├── sandbox/
│   ├── index.ts          # SandboxManager (isolated-vm)
│   ├── d365-api.ts       # D365 API bindings for sandbox
│   └── types.ts          # Sandbox type definitions
└── tools/
    ├── index.ts          # Tool registration
    ├── describe-entity.ts
    ├── execute-odata.ts
    ├── execute-code.ts
    └── aggregate.ts
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

## License

MIT
