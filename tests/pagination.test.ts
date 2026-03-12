import { describe, it, expect, vi } from "vitest";
import { fetchPageWithRetry, paginatedFetch, type PaginatedFetchResult } from "../src/utils/pagination.js";
import { D365Client, D365Error } from "../src/d365-client.js";

// Create a mock D365Client
function createMockClient(responses: Array<{ value: unknown[]; "@odata.count"?: number; "@odata.nextLink"?: string } | Error>) {
  let callIndex = 0;
  const client = {
    request: vi.fn(async () => {
      const response = responses[callIndex++];
      if (response instanceof Error) throw response;
      return response;
    }),
  } as unknown as D365Client;
  return client;
}

describe("fetchPageWithRetry", () => {
  it("returns data on successful request", async () => {
    const client = createMockClient([{ value: [{ id: 1 }] }]);
    const result = await fetchPageWithRetry(client, "/test");
    expect(result).toEqual({ value: [{ id: 1 }] });
  });

  it("retries on server error and succeeds", async () => {
    const client = createMockClient([
      new D365Error("Server error", 503),
      { value: [{ id: 1 }] },
    ]);
    const result = await fetchPageWithRetry(client, "/test", 1);
    expect(result).toEqual({ value: [{ id: 1 }] });
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 404", async () => {
    const client = createMockClient([new D365Error("Not found", 404)]);
    await expect(fetchPageWithRetry(client, "/test")).rejects.toThrow("Not found");
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("does not retry on 400", async () => {
    const client = createMockClient([new D365Error("Bad request", 400)]);
    await expect(fetchPageWithRetry(client, "/test")).rejects.toThrow("Bad request");
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("does not retry on 401", async () => {
    const client = createMockClient([new D365Error("Unauthorized", 401)]);
    await expect(fetchPageWithRetry(client, "/test")).rejects.toThrow("Unauthorized");
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws after max retries exhausted", async () => {
    const client = createMockClient([
      new D365Error("Server error", 503),
      new D365Error("Server error", 503),
      new D365Error("Server error", 503),
    ]);
    await expect(fetchPageWithRetry(client, "/test", 2)).rejects.toThrow("Server error");
    expect(client.request).toHaveBeenCalledTimes(3);
  });
});

describe("paginatedFetch", () => {
  it("fetches a single page", async () => {
    const client = createMockClient([
      { value: [{ id: 1 }, { id: 2 }], "@odata.count": 2 },
    ]);

    const result = await paginatedFetch(client, "/test", { maxRecords: 100 });
    expect(result.records).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.pagesFetched).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("follows pagination links", async () => {
    const client = createMockClient([
      { value: [{ id: 1 }], "@odata.count": 3, "@odata.nextLink": "http://next1" },
      { value: [{ id: 2 }], "@odata.nextLink": "http://next2" },
      { value: [{ id: 3 }] },
    ]);

    const result = await paginatedFetch(client, "/test", { maxRecords: 100 });
    expect(result.records).toHaveLength(3);
    expect(result.totalCount).toBe(3);
    expect(result.pagesFetched).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("respects maxRecords limit", async () => {
    const client = createMockClient([
      { value: [{ id: 1 }, { id: 2 }], "@odata.count": 10, "@odata.nextLink": "http://next" },
    ]);

    const result = await paginatedFetch(client, "/test", { maxRecords: 2 });
    expect(result.records).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("adds $count=true when ensureCount is not false", async () => {
    const client = createMockClient([{ value: [{ id: 1 }] }]);
    await paginatedFetch(client, "/test?$top=10", { maxRecords: 100 });
    expect(client.request).toHaveBeenCalledWith(
      expect.stringContaining("$count=true"),
      {},
      expect.any(Number)
    );
  });

  it("does not add $count=true when ensureCount is false", async () => {
    const client = createMockClient([{ value: [{ id: 1 }] }]);
    await paginatedFetch(client, "/test", { maxRecords: 100, ensureCount: false });
    expect(client.request).toHaveBeenCalledWith(
      "/test",
      {},
      expect.any(Number)
    );
  });
});
