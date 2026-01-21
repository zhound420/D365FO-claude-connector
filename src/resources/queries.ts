/**
 * Saved Queries resource - list and view saved query templates
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadSavedQueries, type SavedQuery } from "../tools/saved-queries.js";

/**
 * Extract parameter names from a query template
 */
function extractParameterNames(query: SavedQuery): string[] {
  const params = new Set<string>();
  const pattern = /\{\{(\w+)\}\}/g;

  const checkString = (str: string | undefined) => {
    if (!str) return;
    let match;
    while ((match = pattern.exec(str)) !== null) {
      params.add(match[1]);
    }
  };

  checkString(query.filter);
  checkString(query.orderBy);
  checkString(query.expand);
  query.select?.forEach(checkString);

  return Array.from(params);
}

/**
 * Format a saved query for display
 */
function formatQuery(query: SavedQuery): Record<string, unknown> {
  const params = extractParameterNames(query);

  return {
    name: query.name,
    description: query.description,
    entity: query.entity,
    select: query.select,
    filter: query.filter,
    orderBy: query.orderBy,
    top: query.top,
    expand: query.expand,
    parameters: params.length > 0 ? params : undefined,
    createdAt: query.createdAt,
    updatedAt: query.updatedAt,
  };
}

/**
 * Register the saved queries resource
 */
export function registerQueriesResource(server: McpServer): void {
  server.resource(
    "d365-queries",
    "d365://queries",
    {
      description: "List all saved D365 query templates. Use save_query to create new queries, execute_saved_query to run them.",
      mimeType: "application/json",
    },
    async (uri) => {
      const queries = loadSavedQueries();
      const queryList = Object.values(queries);

      // Sort by name
      queryList.sort((a, b) => a.name.localeCompare(b.name));

      const result = {
        count: queryList.length,
        queries: queryList.map(formatQuery),
        usage: {
          create: "Use save_query tool to create new query templates",
          execute: "Use execute_saved_query tool to run a saved query",
          delete: "Use delete_saved_query tool to remove a query",
          parameters: "Use {{paramName}} syntax in filter/orderBy/expand for substitutable parameters",
        },
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
