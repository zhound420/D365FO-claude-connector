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

## Usage with Claude Code

Add to your Claude Code MCP configuration (`~/.claude/claude_desktop_config.json`):

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
    └── execute-code.ts
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
