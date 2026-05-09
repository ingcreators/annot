/**
 * @vitest-environment happy-dom
 *
 * Direct unit tests for `createGoogleDriveApiClient`. Uses a typed
 * fetch stub so every retry / 401 / error-mapping path runs in
 * milliseconds without MSW or a real Drive endpoint. Mirrors
 * `github-api-client.test.ts` for the symmetric branches.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createGoogleDriveApiClient,
  type DriveError,
  type FetchLike,
} from "./google-drive-api-client.js";

function scriptFetch(
  script: Array<{ status: number; body?: string }>,
): FetchLike & { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn = ((url, init) => {
    calls.push({ url, init });
    const next = script[i++];
    if (!next) throw new Error(`scriptFetch: ran out of scripted responses (call ${i})`);
    return Promise.resolve(new Response(next.body ?? "", { status: next.status }));
  }) as ReturnType<typeof scriptFetch>;
  fn.calls = calls;
  return fn;
}

describe("GoogleDriveApiClient.request — success", () => {
  it("attaches the Authorization header on every call", async () => {
    const fetchImpl = scriptFetch([{ status: 200, body: "{}" }]);
    const client = createGoogleDriveApiClient("tok-1", { fetchImpl });
    await client.request("https://www.googleapis.com/drive/v3/files");
    const headers = fetchImpl.calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-1");
  });

  it("forwards caller-supplied headers alongside Authorization", async () => {
    const fetchImpl = scriptFetch([{ status: 200, body: "{}" }]);
    const client = createGoogleDriveApiClient("tok-1", { fetchImpl });
    await client.request("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const headers = fetchImpl.calls[0]!.init!.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer tok-1");
  });

  it("returns the raw Response without consuming the body", async () => {
    const fetchImpl = scriptFetch([{ status: 200, body: '{"id":"abc"}' }]);
    const client = createGoogleDriveApiClient("tok-1", { fetchImpl });
    const resp = await client.request("https://www.googleapis.com/drive/v3/files/abc");
    expect(await resp.json()).toEqual({ id: "abc" });
  });
});

describe("GoogleDriveApiClient.request — error mapping", () => {
  it("throws a DriveError carrying status + truncated message", async () => {
    const fetchImpl = scriptFetch([{ status: 404, body: "File not found" }]);
    const client = createGoogleDriveApiClient("tok-1", { fetchImpl });
    await expect(
      client.request("https://www.googleapis.com/drive/v3/files/abc"),
    ).rejects.toMatchObject({
      driveError: true,
      status: 404,
      message: "Drive API 404: File not found",
    });
  });

  it("truncates the body to 200 chars in the error message", async () => {
    const longBody = "x".repeat(500);
    const fetchImpl = scriptFetch([{ status: 500, body: longBody }]);
    const client = createGoogleDriveApiClient("tok-1", { fetchImpl });
    await expect(client.request("https://www.googleapis.com/drive/v3/files")).rejects.toSatisfy(
      (err) => {
        const msg = (err as DriveError).message;
        // "Drive API 500: " (15 chars) + 200 body chars = 215 total.
        return msg.length === 215;
      },
    );
  });
});

describe("GoogleDriveApiClient.request — 401 token refresh", () => {
  it("throws on 401 when no refresher is registered", async () => {
    const fetchImpl = scriptFetch([{ status: 401, body: "Unauthorized" }]);
    const client = createGoogleDriveApiClient("tok-stale", { fetchImpl });
    await expect(client.request("https://www.googleapis.com/drive/v3/files")).rejects.toMatchObject(
      { status: 401 },
    );
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("retries once with the refreshed token on 401", async () => {
    const fetchImpl = scriptFetch([
      { status: 401, body: "Unauthorized" },
      { status: 200, body: "{}" },
    ]);
    const client = createGoogleDriveApiClient("tok-stale", { fetchImpl });
    client.setTokenRefresher(async () => "tok-fresh");
    const resp = await client.request("https://www.googleapis.com/drive/v3/files");
    expect(resp.status).toBe(200);
    expect(fetchImpl.calls).toHaveLength(2);
    const retryHeaders = fetchImpl.calls[1]!.init!.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe("Bearer tok-fresh");
  });

  it("propagates the original 401 if the refresher returns null", async () => {
    const fetchImpl = scriptFetch([{ status: 401, body: "Unauthorized" }]);
    const client = createGoogleDriveApiClient("tok-stale", { fetchImpl });
    client.setTokenRefresher(async () => null);
    await expect(client.request("https://www.googleapis.com/drive/v3/files")).rejects.toMatchObject(
      { status: 401 },
    );
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("coalesces concurrent 401 refreshes (refresher fires once)", async () => {
    const fetchImpl = scriptFetch([
      { status: 401, body: "" }, // request A first attempt
      { status: 401, body: "" }, // request B first attempt
      { status: 200, body: "{}" }, // request A retry
      { status: 200, body: "{}" }, // request B retry
    ]);
    const client = createGoogleDriveApiClient("tok-stale", { fetchImpl });
    const refresher = vi.fn(async () => "tok-fresh");
    client.setTokenRefresher(refresher);
    const [a, b] = await Promise.all([
      client.request("https://www.googleapis.com/drive/v3/files/a"),
      client.request("https://www.googleapis.com/drive/v3/files/b"),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it("setToken updates subsequent requests' Authorization header", async () => {
    const fetchImpl = scriptFetch([
      { status: 200, body: "{}" },
      { status: 200, body: "{}" },
    ]);
    const client = createGoogleDriveApiClient("tok-1", { fetchImpl });
    await client.request("https://www.googleapis.com/drive/v3/files/a");
    client.setToken("tok-2");
    await client.request("https://www.googleapis.com/drive/v3/files/b");
    const h0 = fetchImpl.calls[0]!.init!.headers as Record<string, string>;
    const h1 = fetchImpl.calls[1]!.init!.headers as Record<string, string>;
    expect(h0.Authorization).toBe("Bearer tok-1");
    expect(h1.Authorization).toBe("Bearer tok-2");
  });

  it("throws DriveError when the 401-retry itself fails", async () => {
    const fetchImpl = scriptFetch([
      { status: 401, body: "" },
      { status: 500, body: "internal" },
    ]);
    const client = createGoogleDriveApiClient("tok-stale", { fetchImpl });
    client.setTokenRefresher(async () => "tok-fresh");
    await expect(client.request("https://www.googleapis.com/drive/v3/files")).rejects.toMatchObject(
      { status: 500 },
    );
  });
});
