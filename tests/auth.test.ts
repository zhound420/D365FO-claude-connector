import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenManager } from "../src/auth.js";
import type { D365Config } from "../src/types.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock config.ts logging to avoid side effects
vi.mock("../src/config.js", () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

const testConfig: D365Config = {
  tenantId: "test-tenant",
  clientId: "test-client",
  clientSecret: "test-secret",
  environmentUrl: "https://test.dynamics.com",
};

function mockTokenResponse(expiresIn = 3600) {
  return {
    ok: true,
    json: async () => ({
      access_token: `token-${Date.now()}`,
      token_type: "Bearer",
      expires_in: expiresIn,
      resource: "https://test.dynamics.com",
    }),
  };
}

describe("TokenManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a new token on first call", async () => {
    mockFetch.mockResolvedValueOnce(mockTokenResponse());

    const tm = new TokenManager(testConfig);
    const token = await tm.getToken();

    expect(token).toMatch(/^token-/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns cached token on subsequent calls", async () => {
    mockFetch.mockResolvedValueOnce(mockTokenResponse());

    const tm = new TokenManager(testConfig);
    const token1 = await tm.getToken();
    const token2 = await tm.getToken();

    expect(token1).toBe(token2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent refresh requests", async () => {
    mockFetch.mockResolvedValueOnce(mockTokenResponse());

    const tm = new TokenManager(testConfig);
    const [token1, token2, token3] = await Promise.all([
      tm.getToken(),
      tm.getToken(),
      tm.getToken(),
    ]);

    expect(token1).toBe(token2);
    expect(token2).toBe(token3);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("invalidates token on error and clears cache", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    mockFetch.mockResolvedValueOnce(mockTokenResponse());

    const tm = new TokenManager(testConfig);

    // First call should fail
    await expect(tm.getToken()).rejects.toThrow("network error");

    // Second call should try again (not use stale cache)
    const token = await tm.getToken();
    expect(token).toMatch(/^token-/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("invalidates token on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    mockFetch.mockResolvedValueOnce(mockTokenResponse());

    const tm = new TokenManager(testConfig);

    await expect(tm.getToken()).rejects.toThrow("Failed to acquire token");

    // Should try again, not use stale cache
    const token = await tm.getToken();
    expect(token).toMatch(/^token-/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("manual invalidateToken forces refresh", async () => {
    let tokenCounter = 0;
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        access_token: `token-${++tokenCounter}`,
        token_type: "Bearer",
        expires_in: 3600,
        resource: "https://test.dynamics.com",
      }),
    }));

    const tm = new TokenManager(testConfig);
    const token1 = await tm.getToken();
    tm.invalidateToken();
    const token2 = await tm.getToken();

    expect(token1).not.toBe(token2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
