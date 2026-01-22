# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that enables Claude to interact with Microsoft Dynamics 365 Finance & Operations environments. It supports:
- **Multi-environment configuration** - Connect to multiple D365 environments (production, UAT, dev)
- **Read operations** - Query data on all environments
- **Write operations** - Create/update/delete records on non-production environments only
- **Production safety** - Production environments are always read-only by design

## Build Commands

```bash
npm run build    # Compile TypeScript to dist/
npm run dev      # Watch mode - recompile on changes
npm start        # Run the compiled server
```

No test or lint commands are configured.

## Architecture

```
index.ts (entry)
    ├── EnvironmentManager
    │   ├── D365Client (per environment)
    │   └── MetadataCache (per environment)
    │
    ├── Resources (d365://entities, d365://entity/{name}, d365://enums, d365://queries)
    │   └── Uses default environment's MetadataCache
    │
    └── Tools (all support optional 'environment' parameter)
        ├── Read Tools: describe_entity, execute_odata, aggregate, search_entity, etc.
        └── Write Tools: create_record, update_record, delete_record (non-production only)
```

**Core Components:**
- `environment-manager.ts` - Manages multiple D365Client instances, enforces write guards
- `config-loader.ts` - Loads JSON config with fallback to legacy env vars
- `d365-client.ts` - Authenticated OData HTTP client with read/write methods
- `auth.ts` - TokenManager for OAuth2 client credentials flow with auto-refresh
- `metadata-cache.ts` - Two-tier metadata loading (fast entity names ~1s, full EDMX ~30-60s) with 24h TTL

**Resources** (`src/resources/`) - Schema discovery endpoints for Claude to understand D365 structure

**Tools** (`src/tools/`) - Data access operations. Each tool is registered via:
```typescript
export function register[ToolName]Tool(server: McpServer, envManager: EnvironmentManager): void {
  server.tool("tool_name", "description", { /* Zod schema */ }, async (params, extra) => {
    const client = envManager.getClient(params.environment);
    // ... handler
  });
}
```

## Key Patterns

### Multi-Environment Support
All tools accept an optional `environment` parameter:
```typescript
{
  entity: z.string(),
  environment: z.string().optional().describe("Target environment (default: configured default)")
}
```

### Write Guard Pattern
For write operations, always check permissions first:
```typescript
// This throws WriteNotAllowedError if environment is production
envManager.assertWriteAllowed(environment);
```

### Tool Implementation
1. Zod schema defines parameters with `.describe()` for Claude
2. Get client from envManager: `const client = envManager.getClient(environment)`
3. Handler returns `{ content: [{ type: "text", text: "..." }] }` or `{ ..., isError: true }`
4. Use `D365Error` for API errors (includes status code, OData error details, retry-after)

### Metadata Strategy
1. Fast tier: Entity names from root endpoint (~1s)
2. Sample inference: Fetch single record, infer types (2s)
3. Full EDMX: Complete schema with keys/relationships (30-60s, cached 24h)

### Pagination
```typescript
let nextLink: string | undefined = initialPath;
while (nextLink) {
  const response = await client.request(nextLink);
  // process response.value
  nextLink = response["@odata.nextLink"];
}
```

### Progress Reporting
For slow operations:
```typescript
const progress = new ProgressReporter(server, "tool_name", extra.sessionId);
await progress.report("Processing...");
```

## Configuration

### Multi-Environment (Recommended)
Create `d365-environments.json` in the project root:
```json
{
  "environments": [
    {
      "name": "production",
      "displayName": "Production",
      "type": "production",
      "tenantId": "...",
      "clientId": "...",
      "clientSecret": "...",
      "environmentUrl": "https://contoso.operations.dynamics.com",
      "default": true
    },
    {
      "name": "uat",
      "displayName": "UAT",
      "type": "non-production",
      "tenantId": "...",
      "clientId": "...",
      "clientSecret": "...",
      "environmentUrl": "https://contoso-uat.sandbox.operations.dynamics.com"
    }
  ]
}
```

- **type: "production"** = read-only (all write operations blocked)
- **type: "non-production"** = read/write enabled

### Legacy Single Environment
Falls back to environment variables if no JSON config:
- `D365_TENANT_ID` - Azure AD tenant
- `D365_CLIENT_ID` - App registration client ID
- `D365_CLIENT_SECRET` - App registration secret
- `D365_ENVIRONMENT_URL` - e.g., `https://contoso.operations.dynamics.com`
- `D365_ENVIRONMENT_TYPE` - Optional: "production" or "non-production" (defaults to "production")

### Transport Options
- `D365_TRANSPORT` - `stdio` (default) or `http`
- `D365_HTTP_PORT` - Port for HTTP mode (default: 3000)

## D365 OData Constraints

- **No $apply support**: D365 F&O has limited server-side aggregation - tools use client-side fallback
- **contains() issues**: Special characters like `&` fail - `search_entity` tool has fallback strategies
- **5K default limit**: Aggregate operations cap at 5000 records unless `accurate=true`
- **Header totals often $0**: Use `SalesOrderLinesV2.LineAmount` for accurate spend calculations

## Adding New Tools

1. Create `src/tools/my-tool.ts` with `registerMyToolTool(server, envManager)` function
2. Import and call in `src/tools/index.ts`
3. Add `environment: environmentSchema` to the tool's schema
4. Get client with `envManager.getClient(environment)`
5. For write tools, call `envManager.assertWriteAllowed(environment)` first
6. Run `npm run build`

## Adding New Resources

1. Create `src/resources/my-resource.ts` with `registerMyResource(server, cache)` function
2. Import and call in `src/resources/index.ts`
3. URI pattern: `d365://resource-name`

## Write Operations Safety

Write operations are only available on non-production environments:

```typescript
// In write tools:
try {
  envManager.assertWriteAllowed(environment);
} catch (error) {
  if (error instanceof WriteNotAllowedError) {
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
  throw error;
}

// Then perform the write:
const { record, etag } = await client.createRecord(entity, data);
await client.updateRecord(entity, key, data, etag);
await client.deleteRecord(entity, key, etag);
```
