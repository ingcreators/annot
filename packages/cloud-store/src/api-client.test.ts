// Targeted tests for `ApiClient` error mapping. The end-to-end
// `cloud-store.test.ts` exercises the happy paths; these tests
// pin the failure modes the StorageProvider error contract relies on.

import { StoragePermissionError, StorageQuotaError } from "@ingcreators/annot-core/storage";
import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "./api-client.js";

function mockResponse(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

describe("ApiClient.raiseForStatus", () => {
  it("maps 401 → StoragePermissionError", async () => {
    const client = new ApiClient({
      baseUrl: "http://test.local",
      fetchImpl: mockResponse(401, { ok: false, error: "no_session", message: "expired" }),
    });
    await expect(client.getJson("/api/anything", "foo.png")).rejects.toBeInstanceOf(
      StoragePermissionError,
    );
  });

  it("maps 413 quota_exceeded → StorageQuotaError", async () => {
    const client = new ApiClient({
      baseUrl: "http://test.local",
      fetchImpl: mockResponse(413, {
        ok: false,
        error: "quota_exceeded",
        exceeded: "storage",
        plan: "free",
      }),
    });
    await expect(client.getJson("/api/anything", "foo.png")).rejects.toBeInstanceOf(
      StorageQuotaError,
    );
  });

  it("maps 413 payload_too_large → ApiError (not quota)", async () => {
    const client = new ApiClient({
      baseUrl: "http://test.local",
      fetchImpl: mockResponse(413, { ok: false, error: "payload_too_large", message: "too big" }),
    });
    try {
      await client.getJson("/api/anything", "foo.png");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).not.toBeInstanceOf(StorageQuotaError);
    }
  });

  it("maps 409 → ApiError so the caller can pick conflict vs uniquify", async () => {
    const client = new ApiClient({
      baseUrl: "http://test.local",
      fetchImpl: mockResponse(409, {
        ok: false,
        error: "path_conflict",
        existingImageId: "existing-uuid",
      }),
    });
    try {
      await client.getJson("/api/anything", "foo.png");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      if (err instanceof ApiError) {
        expect(err.status).toBe(409);
        expect(err.body?.error).toBe("path_conflict");
      }
    }
  });

  it("maps 500 with no JSON body → ApiError with synthesized message", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    const client = new ApiClient({ baseUrl: "http://test.local", fetchImpl });
    try {
      await client.getJson("/api/anything", "foo.png");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      if (err instanceof ApiError) {
        expect(err.status).toBe(500);
        expect(err.body).toBeNull();
      }
    }
  });
});

describe("ApiClient.url", () => {
  it("strips trailing slash from baseUrl", () => {
    const c = new ApiClient({ baseUrl: "http://test.local/", fetchImpl: mockResponse(200, {}) });
    expect(c.url("/api/foo")).toBe("http://test.local/api/foo");
  });

  it("rejects relative-path inputs", () => {
    const c = new ApiClient({ baseUrl: "http://test.local", fetchImpl: mockResponse(200, {}) });
    expect(() => c.url("api/foo")).toThrow();
  });
});
