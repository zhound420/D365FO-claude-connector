/**
 * Sandbox execution manager using isolated-vm
 * Provides a secure JavaScript execution environment with D365 API access
 */

import ivm from "isolated-vm";
import type { D365Client } from "../d365-client.js";
import type { MetadataCache } from "../metadata-cache.js";
import type { SandboxConfig, SandboxResult, SandboxError } from "./types.js";
import { DEFAULT_SANDBOX_CONFIG } from "./types.js";
import { createD365Api } from "./d365-api.js";
import { log, logError } from "../config.js";

/**
 * Sandbox manager for secure code execution
 */
export class SandboxManager {
  private config: Required<SandboxConfig>;
  private d365Api: ReturnType<typeof createD365Api>;

  constructor(client: D365Client, metadataCache: MetadataCache, config?: SandboxConfig) {
    this.config = {
      ...DEFAULT_SANDBOX_CONFIG,
      ...config,
    };
    this.d365Api = createD365Api(client, metadataCache);
  }

  /**
   * Execute JavaScript code in a sandboxed environment
   */
  async execute(code: string): Promise<SandboxResult> {
    const startTime = Date.now();
    const logs: string[] = [];

    // Create isolate with memory limit
    const isolate = new ivm.Isolate({ memoryLimit: this.config.memoryLimit });

    try {
      // Create context
      const context = await isolate.createContext();
      const jail = context.global;

      // Set up global reference
      await jail.set("global", jail.derefInto());

      // Set up console.log capture
      const logRef = new ivm.Reference((message: string) => {
        logs.push(message);
      });
      await jail.set("_log", logRef);

      // Create D365 API reference for async method calls
      const d365Reference = new ivm.Reference({
        query: async (entity: string, options: unknown) => {
          const result = await this.d365Api.query(entity, options as Parameters<typeof this.d365Api.query>[1]);
          return new ivm.ExternalCopy(result).copyInto();
        },
        get: async (entity: string, key: unknown, options: unknown) => {
          const result = await this.d365Api.get(
            entity,
            key as Parameters<typeof this.d365Api.get>[1],
            options as Parameters<typeof this.d365Api.get>[2]
          );
          return new ivm.ExternalCopy(result).copyInto();
        },
        count: async (entity: string, filter?: string) => {
          return this.d365Api.count(entity, filter);
        },
        describe: async (entity: string) => {
          const result = await this.d365Api.describe(entity);
          return result ? new ivm.ExternalCopy(result).copyInto() : null;
        },
        getEnum: async (enumName: string) => {
          const result = await this.d365Api.getEnum(enumName);
          return result ? new ivm.ExternalCopy(result).copyInto() : null;
        },
        odata: async (path: string) => {
          const result = await this.d365Api.odata(path);
          return new ivm.ExternalCopy(result).copyInto();
        },
      });
      await jail.set("_d365Ref", d365Reference);

      // Bootstrap code to create usable d365 object and console
      const bootstrap = `
        const console = {
          log: (...args) => _log.applySync(undefined, [args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')]),
          warn: (...args) => _log.applySync(undefined, ['[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')]),
          error: (...args) => _log.applySync(undefined, ['[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')]),
        };

        const d365 = {
          async query(entity, options) {
            return _d365Ref.apply(undefined, ['query', [entity, options]], {
              arguments: { copy: true },
              result: { promise: true, copy: true }
            });
          },
          async get(entity, key, options) {
            return _d365Ref.apply(undefined, ['get', [entity, key, options]], {
              arguments: { copy: true },
              result: { promise: true, copy: true }
            });
          },
          async count(entity, filter) {
            return _d365Ref.apply(undefined, ['count', [entity, filter]], {
              arguments: { copy: true },
              result: { promise: true }
            });
          },
          async describe(entity) {
            return _d365Ref.apply(undefined, ['describe', [entity]], {
              arguments: { copy: true },
              result: { promise: true, copy: true }
            });
          },
          async getEnum(enumName) {
            return _d365Ref.apply(undefined, ['getEnum', [enumName]], {
              arguments: { copy: true },
              result: { promise: true, copy: true }
            });
          },
          async odata(path) {
            return _d365Ref.apply(undefined, ['odata', [path]], {
              arguments: { copy: true },
              result: { promise: true, copy: true }
            });
          }
        };
      `;

      // Compile and run bootstrap
      const bootstrapScript = await isolate.compileScript(bootstrap);
      await bootstrapScript.run(context);

      // Wrap user code in async function
      const wrappedCode = `
        (async () => {
          ${code}
        })()
      `;

      // Compile user code
      const userScript = await isolate.compileScript(wrappedCode);

      // Execute with timeout using Promise.race
      const result = await Promise.race([
        userScript.run(context, { promise: true }),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Execution timeout after ${this.config.timeout}ms`));
          }, this.config.timeout + 1000); // Add buffer for cleanup
        }),
      ]);

      const executionTime = Date.now() - startTime;
      log(`Sandbox execution completed in ${executionTime}ms`);

      return {
        value: result,
        logs,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const sandboxError = this.parseSandboxError(error);

      logError("Sandbox execution failed", error);

      throw {
        ...sandboxError,
        logs,
        executionTime,
      };
    } finally {
      // Clean up isolate
      isolate.dispose();
    }
  }

  /**
   * Parse error into SandboxError format
   */
  private parseSandboxError(error: unknown): SandboxError {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    return {
      message,
      stack,
      isTimeout: message.includes("timeout") || message.includes("Timeout"),
      isMemoryLimit: message.includes("memory") || message.includes("Memory"),
    };
  }
}

export { createD365Api } from "./d365-api.js";
export type { SandboxConfig, SandboxResult, SandboxError, D365SandboxApi } from "./types.js";
