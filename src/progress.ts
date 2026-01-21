/**
 * Progress reporting utility for MCP tools
 * Sends logging messages to the MCP client during slow operations
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log } from "./config.js";

/**
 * ProgressReporter - tracks and reports progress for slow operations
 *
 * Sends progress updates via MCP logging messages and always logs to stderr.
 * The sessionId from the MCP extra parameter enables proper message routing.
 */
export class ProgressReporter {
  private server: McpServer;
  private sessionId?: string;
  private startTime: number;
  private operation: string;

  constructor(server: McpServer, operation: string, sessionId?: string) {
    this.server = server;
    this.sessionId = sessionId;
    this.startTime = Date.now();
    this.operation = operation;
  }

  /**
   * Report progress with an elapsed time suffix
   */
  async report(message: string): Promise<void> {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const fullMessage = `[${this.operation}] ${message} (${elapsed}s)`;
    log(fullMessage);
    try {
      await this.server.sendLoggingMessage({
        level: "info",
        logger: "d365-mcp",
        data: fullMessage,
      });
    } catch {
      /* client may not support logging */
    }
  }

  /**
   * Get elapsed time in seconds as a formatted string
   */
  getElapsed(): string {
    return ((Date.now() - this.startTime) / 1000).toFixed(1);
  }

  /**
   * Get elapsed time in milliseconds
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * Format timing information for inclusion in responses
 * Only includes timing if elapsed time exceeds threshold
 */
export function formatTiming(elapsedMs: number, thresholdMs: number = 2000): string {
  if (elapsedMs < thresholdMs) {
    return "";
  }
  return ` (${(elapsedMs / 1000).toFixed(1)}s)`;
}
