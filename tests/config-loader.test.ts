import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs before importing the module
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

// Mock config.ts
vi.mock("../src/config.js", () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { readFileSync, existsSync } from "fs";
import {
  loadEnvironmentsConfig,
  getDefaultEnvironment,
  getEnvironmentByName,
  toD365Config,
  ConfigurationError,
} from "../src/config-loader.js";

const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);

const validConfig = {
  environments: [
    {
      name: "production",
      displayName: "Production",
      type: "production",
      tenantId: "tenant-1",
      clientId: "client-1",
      clientSecret: "secret-1",
      environmentUrl: "https://prod.dynamics.com",
      default: true,
    },
    {
      name: "uat",
      displayName: "UAT",
      type: "non-production",
      tenantId: "tenant-1",
      clientId: "client-2",
      clientSecret: "secret-2",
      environmentUrl: "https://uat.sandbox.dynamics.com/",
    },
  ],
};

describe("config-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up env vars
    delete process.env.D365_CONFIG_FILE;
    delete process.env.D365_SINGLE_ENV;
    delete process.env.D365_TENANT_ID;
    delete process.env.D365_CLIENT_ID;
    delete process.env.D365_CLIENT_SECRET;
    delete process.env.D365_ENVIRONMENT_URL;
    delete process.env.D365_ENVIRONMENT_TYPE;
    delete process.env.D365_ENVIRONMENT_NAME;
    delete process.env.D365_ENVIRONMENT_DISPLAY_NAME;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadEnvironmentsConfig - JSON file", () => {
    it("loads valid JSON config", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(validConfig));

      const config = loadEnvironmentsConfig();
      expect(config.environments).toHaveLength(2);
      expect(config.environments[0].name).toBe("production");
      expect(config.environments[1].name).toBe("uat");
    });

    it("normalizes trailing slash in URL", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(validConfig));

      const config = loadEnvironmentsConfig();
      expect(config.environments[1].environmentUrl).toBe("https://uat.sandbox.dynamics.com");
    });

    it("throws on invalid JSON", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("not json");

      expect(() => loadEnvironmentsConfig()).toThrow(ConfigurationError);
    });

    it("throws on empty environments array", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ environments: [] }));

      expect(() => loadEnvironmentsConfig()).toThrow("at least one environment");
    });

    it("throws on duplicate environment names", () => {
      const dupConfig = {
        environments: [
          { ...validConfig.environments[0] },
          { ...validConfig.environments[0], displayName: "Duplicate" },
        ],
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(dupConfig));

      expect(() => loadEnvironmentsConfig()).toThrow("Duplicate environment name");
    });

    it("throws on invalid environment type", () => {
      const badConfig = {
        environments: [
          { ...validConfig.environments[0], type: "staging" },
        ],
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(badConfig));

      expect(() => loadEnvironmentsConfig()).toThrow("production\" or \"non-production");
    });

    it("auto-selects first environment as default when none specified", () => {
      const noDefault = {
        environments: [
          { ...validConfig.environments[0], default: false },
          { ...validConfig.environments[1] },
        ],
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(noDefault));

      const config = loadEnvironmentsConfig();
      expect(config.environments[0].default).toBe(true);
    });
  });

  describe("loadEnvironmentsConfig - env var fallback", () => {
    it("falls back to env vars when no config file", () => {
      mockExistsSync.mockReturnValue(false);
      process.env.D365_TENANT_ID = "tenant-1";
      process.env.D365_CLIENT_ID = "client-1";
      process.env.D365_CLIENT_SECRET = "secret-1";
      process.env.D365_ENVIRONMENT_URL = "https://prod.dynamics.com";

      const config = loadEnvironmentsConfig();
      expect(config.environments).toHaveLength(1);
      expect(config.environments[0].type).toBe("production");
    });

    it("infers non-production from sandbox URL", () => {
      mockExistsSync.mockReturnValue(false);
      process.env.D365_TENANT_ID = "tenant-1";
      process.env.D365_CLIENT_ID = "client-1";
      process.env.D365_CLIENT_SECRET = "secret-1";
      process.env.D365_ENVIRONMENT_URL = "https://test.sandbox.dynamics.com";

      const config = loadEnvironmentsConfig();
      expect(config.environments[0].type).toBe("non-production");
    });

    it("throws on missing required env vars", () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => loadEnvironmentsConfig()).toThrow("D365_TENANT_ID");
    });
  });

  describe("getDefaultEnvironment", () => {
    it("returns the default environment", () => {
      const env = getDefaultEnvironment({
        environments: validConfig.environments.map((e, i) => ({
          ...e,
          default: i === 0,
        })),
      });
      expect(env.name).toBe("production");
    });

    it("throws when no default set", () => {
      expect(() =>
        getDefaultEnvironment({
          environments: validConfig.environments.map(e => ({ ...e, default: false })),
        })
      ).toThrow("No default environment");
    });
  });

  describe("getEnvironmentByName", () => {
    const config = { environments: validConfig.environments.map(e => ({ ...e })) };

    it("finds environment by name", () => {
      const env = getEnvironmentByName(config, "uat");
      expect(env?.name).toBe("uat");
    });

    it("returns undefined for unknown name", () => {
      const env = getEnvironmentByName(config, "nonexistent");
      expect(env).toBeUndefined();
    });
  });

  describe("toD365Config", () => {
    it("converts EnvironmentConfig to D365Config", () => {
      const env = validConfig.environments[0];
      const d365Config = toD365Config(env as any);
      expect(d365Config).toEqual({
        tenantId: "tenant-1",
        clientId: "client-1",
        clientSecret: "secret-1",
        environmentUrl: "https://prod.dynamics.com",
      });
    });
  });
});
