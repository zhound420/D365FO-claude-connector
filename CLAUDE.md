# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that enables Claude to interact with Microsoft Dynamics 365 Finance & Operations environments. It provides read-only access to D365 data through OData APIs.

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
    ├── Resources (d365://entities, d365://entity/{name}, d365://enums, d365://queries)
    │   └── MetadataCache → D365Client → Azure AD OAuth2 → D365 OData API
    │
    └── Tools (describe_entity, execute_odata, aggregate, search_entity, analyze_customer, etc.)
        └── D365Client → Azure AD OAuth2 → D365 OData API
```

**Core Components:**
- `d365-client.ts` - Authenticated OData HTTP client with pagination and error handling
- `auth.ts` - TokenManager for OAuth2 client credentials flow with auto-refresh
- `metadata-cache.ts` - Two-tier metadata loading (fast entity names ~1s, full EDMX ~30-60s) with 24h TTL
- `config.ts` - Environment variable loading, supports stdio and HTTP transport modes

**Resources** (`src/resources/`) - Schema discovery endpoints for Claude to understand D365 structure

**Tools** (`src/tools/`) - Data access operations. Each tool is registered via:
```typescript
export function register[ToolName]Tool(server: McpServer, client: D365Client): void {
  server.tool("tool_name", "description", { /* Zod schema */ }, async (params, extra) => { /* handler */ });
}
```

## Key Patterns

### Tool Implementation
All tools follow the same structure:
1. Zod schema defines parameters with `.describe()` for Claude
2. Handler returns `{ content: [{ type: "text", text: "..." }] }` or `{ ..., isError: true }`
3. Use `D365Error` for API errors (includes status code, OData error details, retry-after)

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

## Environment Variables

Required:
- `D365_TENANT_ID` - Azure AD tenant
- `D365_CLIENT_ID` - App registration client ID
- `D365_CLIENT_SECRET` - App registration secret
- `D365_ENVIRONMENT_URL` - e.g., `https://contoso.operations.dynamics.com`

Optional:
- `D365_TRANSPORT` - `stdio` (default) or `http`
- `D365_HTTP_PORT` - Port for HTTP mode (default: 3000)

## D365 OData Constraints

- **No $apply support**: D365 F&O has limited server-side aggregation - tools use client-side fallback
- **contains() issues**: Special characters like `&` fail - `search_entity` tool has fallback strategies
- **5K default limit**: Aggregate operations cap at 5000 records unless `accurate=true`
- **Header totals often $0**: Use `SalesOrderLinesV2.LineAmount` for accurate spend calculations

## Adding New Tools

1. Create `src/tools/my-tool.ts` with `registerMyToolTool(server, client)` function
2. Import and call in `src/tools/index.ts`
3. Run `npm run build`

## Adding New Resources

1. Create `src/resources/my-resource.ts` with `registerMyResource(server, cache)` function
2. Import and call in `src/resources/index.ts`
3. URI pattern: `d365://resource-name`
