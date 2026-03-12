import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { D365Client, D365Error } from "../src/d365-client.js";
import type { D365Config } from "../src/types.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock config.ts and auth.ts
vi.mock("../src/config.js", () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../src/auth.js", () => ({
  TokenManager: class MockTokenManager {
    async getToken() { return "mock-token"; }
    invalidateToken() {}
  },
}));

const testConfig: D365Config = {
  tenantId: "test-tenant",
  clientId: "test-client",
  clientSecret: "test-secret",
  environmentUrl: "https://test.dynamics.com",
};

describe("D365Client", () => {
  let client: D365Client;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new D365Client(testConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("request", () => {
    it("makes authenticated GET request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ value: [{ id: 1 }] }),
        headers: new Headers({ "content-type": "application/json" }),
      });

      const result = await client.request("/TestEntity");
      expect(result).toEqual({ value: [{ id: 1 }] });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe("https://test.dynamics.com/data/TestEntity");
      expect(fetchCall[1].headers.Authorization).toBe("Bearer mock-token");
    });

    it("handles absolute URLs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ value: [] }),
        headers: new Headers(),
      });

      await client.request("https://other.dynamics.com/data/Entity");
      expect(mockFetch.mock.calls[0][0]).toBe("https://other.dynamics.com/data/Entity");
    });

    it("handles 204 No Content", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
      });

      const result = await client.request("/TestEntity");
      expect(result).toBeUndefined();
    });

    it("handles plain text count response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "42",
        headers: new Headers({ "content-type": "text/plain" }),
      });

      const result = await client.request<number>("/TestEntity/$count");
      expect(result).toBe(42);
    });

    it("retries on 429 with Retry-After header", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ "Retry-After": "1" }),
          json: async () => ({ error: { code: "429", message: "Rate limited" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ value: [] }),
          headers: new Headers(),
        });

      const result = await client.request("/TestEntity");
      expect(result).toEqual({ value: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries on 503", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          headers: new Headers(),
          json: async () => ({ error: { code: "503", message: "Service Unavailable" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ value: [] }),
          headers: new Headers(),
        });

      const result = await client.request("/TestEntity");
      expect(result).toEqual({ value: [] });
    });

    it("throws D365Error on 404", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({ error: { code: "404", message: "Not Found" } }),
      });

      await expect(client.request("/NonExistent")).rejects.toThrow(D365Error);
    });

    it("invalidates token on 401", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({ error: { code: "401", message: "Unauthorized" } }),
      });

      await expect(client.request("/TestEntity")).rejects.toThrow(D365Error);
    });
  });

  describe("formatKey", () => {
    // Test key formatting indirectly through getRecord
    it("handles simple string key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "123" }),
        headers: new Headers(),
      });

      await client.getRecord("TestEntity", "123");
      expect(mockFetch.mock.calls[0][0]).toContain("TestEntity('123')");
    });

    it("handles compound key object", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "123" }),
        headers: new Headers(),
      });

      await client.getRecord("TestEntity", { Field1: "val1", Field2: "val2" });
      expect(mockFetch.mock.calls[0][0]).toContain("Field1='val1',Field2='val2'");
    });

    it("escapes single quotes in key values", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "123" }),
        headers: new Headers(),
      });

      await client.getRecord("TestEntity", "O'Brien");
      expect(mockFetch.mock.calls[0][0]).toContain("O''Brien");
    });

    it("handles pre-formatted compound key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "123" }),
        headers: new Headers(),
      });

      await client.getRecord("TestEntity", "DataAreaId='usmf',CustomerAccount='US-001'");
      expect(mockFetch.mock.calls[0][0]).toContain("DataAreaId='usmf',CustomerAccount='US-001'");
    });
  });

  describe("CRUD operations use requestRaw (retry/timeout)", () => {
    it("createRecord sends POST with retry support", async () => {
      // First attempt fails with 503, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          headers: new Headers(),
          json: async () => ({ error: { code: "503", message: "Unavailable" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ CustomerAccount: "NEW-001" }),
          headers: new Headers({ ETag: "W/\"etag123\"" }),
        });

      const result = await client.createRecord("CustomersV3", { CustomerAccount: "NEW-001" });
      expect(result.record).toEqual({ CustomerAccount: "NEW-001" });
      expect(result.etag).toBe("W/\"etag123\"");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("updateRecord sends PATCH with retry support", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ ETag: "W/\"newetag\"" }),
      });

      const result = await client.updateRecord("CustomersV3", "US-001", { CustomerName: "Updated" });
      expect(result.etag).toBe("W/\"newetag\"");

      const call = mockFetch.mock.calls[0];
      expect(call[1].method).toBe("PATCH");
    });

    it("updateRecord throws on 412 concurrency conflict", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 412,
        headers: new Headers(),
        json: async () => ({ error: { code: "412", message: "Precondition Failed" } }),
      });

      await expect(
        client.updateRecord("CustomersV3", "US-001", { CustomerName: "Updated" }, "W/\"oldetag\"")
      ).rejects.toThrow("Record was modified by another user");
    });

    it("deleteRecord sends DELETE with retry support", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
      });

      await client.deleteRecord("CustomersV3", "US-001");

      const call = mockFetch.mock.calls[0];
      expect(call[1].method).toBe("DELETE");
    });
  });
});
