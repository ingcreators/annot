/**
 * @vitest-environment happy-dom
 *
 * Direct unit tests for `createGitHubApiClient`. The real client
 * accepts a `fetchImpl` override so we can drive every retry / 401 /
 * rate-limit / error-mapping path with a typed stub instead of MSW.
 *
 * The shared GitHubStore contract test (`github-store.contract.test.ts`)
 * still exercises the full HTTP layer end-to-end via MSW; these
 * focused tests catch regressions in the layer's discrete behaviors
 * with millisecond-level test runtime.
 */

import { describe, expect, it, vi } from "vitest";
import { createGitHubApiClient, type FetchLike } from "./github-api-client.js";
import type { GitHubError } from "./github-helpers.js";

/** Build a stub fetch that returns the responses in `script` in order.
 *  Each entry is a partial `Response` — `body` defaults to "".  */
function scriptFetch(
  script: Array<{ status: number; body?: string; headers?: Record<string, string> }>,
): FetchLike & { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn = ((url, init) => {
    calls.push({ url, init });
    const next = script[i++];
    if (!next) throw new Error(`scriptFetch: ran out of scripted responses (call ${i})`);
    const headers = new Headers(next.headers || {});
    return Promise.resolve(new Response(next.body ?? "", { status: next.status, headers }));
  }) as ReturnType<typeof scriptFetch>;
  fn.calls = calls;
  return fn;
}

describe("GitHubApiClient.request — success", () => {
  it("attaches Authorization + Accept + X-GitHub-Api-Version on every call", async () => {
    const fetchImpl = scriptFetch([{ status: 200, body: "{}" }]);
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    await client.request("https://api.github.com/repos/x/y");
    const headers = fetchImpl.calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-1");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("forwards caller-supplied headers alongside the defaults", async () => {
    const fetchImpl = scriptFetch([{ status: 201, body: "{}" }]);
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    await client.request("https://api.github.com/repos/x/y", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
    });
    const headers = fetchImpl.calls[0]!.init!.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    // Defaults still present.
    expect(headers.Authorization).toBe("Bearer tok-1");
  });

  it("returns the raw Response without consuming the body", async () => {
    const fetchImpl = scriptFetch([{ status: 200, body: '{"sha":"abc"}' }]);
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    const resp = await client.request("https://api.github.com/x");
    expect(await resp.json()).toEqual({ sha: "abc" });
  });
});

describe("GitHubApiClient.request — error mapping", () => {
  it("throws a GitHubError carrying the parsed message + status", async () => {
    const fetchImpl = scriptFetch([
      { status: 404, body: JSON.stringify({ message: "Not Found" }) },
    ]);
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    await expect(client.request("https://api.github.com/x")).rejects.toMatchObject({
      githubError: true,
      status: 404,
      message: "GitHub API 404: Not Found",
    });
  });

  it("flags 409 responses as conflicts", async () => {
    const fetchImpl = scriptFetch([
      { status: 409, body: JSON.stringify({ message: "Conflict" }) },
    ]);
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    await expect(client.request("https://api.github.com/x")).rejects.toMatchObject({
      githubError: true,
      status: 409,
      conflict: true,
    });
  });

  it("flags 422-with-sha as a conflict but plain 422 as non-conflict", async () => {
    const fetchImpl = scriptFetch([
      { status: 422, body: JSON.stringify({ message: "Stale sha mismatch" }) },
      { status: 422, body: JSON.stringify({ message: "Validation failed" }) },
    ]);
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    await expect(client.request("https://api.github.com/x")).rejects.toMatchObject({
      conflict: true,
    });
    await expect(client.request("https://api.github.com/x")).rejects.toSatisfy(
      (err) => (err as GitHubError).conflict !== true,
    );
  });
});

describe("GitHubApiClient.request — 401 token refresh", () => {
  it("does not retry without a refresher (just throws)", async () => {
    const fetchImpl = scriptFetch([
      { status: 401, body: JSON.stringify({ message: "Bad credentials" }) },
    ]);
    const client = createGitHubApiClient("tok-stale", { fetchImpl });
    await expect(client.request("https://api.github.com/x")).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("retries once with the refreshed token on 401", async () => {
    const fetchImpl = scriptFetch([
      { status: 401, body: JSON.stringify({ message: "Bad credentials" }) },
      { status: 200, body: "{}" },
    ]);
    const client = createGitHubApiClient("tok-stale", { fetchImpl });
    client.setTokenRefresher(async () => "tok-fresh");
    const resp = await client.request("https://api.github.com/x");
    expect(resp.status).toBe(200);
    expect(fetchImpl.calls).toHaveLength(2);
    // Retry uses the fresh token.
    const retryHeaders = fetchImpl.calls[1]!.init!.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe("Bearer tok-fresh");
  });

  it("propagates the original 401 if the refresher returns null", async () => {
    const fetchImpl = scriptFetch([
      { status: 401, body: JSON.stringify({ message: "Bad credentials" }) },
    ]);
    const client = createGitHubApiClient("tok-stale", { fetchImpl });
    client.setTokenRefresher(async () => null);
    await expect(client.request("https://api.github.com/x")).rejects.toMatchObject({
      status: 401,
    });
    // Single call: no retry attempted because refresher returned null.
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("coalesces concurrent 401 → refresh attempts so the refresher fires once", async () => {
    const fetchImpl = scriptFetch([
      { status: 401, body: "{}" }, // request A first attempt
      { status: 401, body: "{}" }, // request B first attempt
      { status: 200, body: "{}" }, // request A retry
      { status: 200, body: "{}" }, // request B retry
    ]);
    const client = createGitHubApiClient("tok-stale", { fetchImpl });
    const refresher = vi.fn(async () => "tok-fresh");
    client.setTokenRefresher(refresher);
    const [a, b] = await Promise.all([
      client.request("https://api.github.com/a"),
      client.request("https://api.github.com/b"),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Both 401s shared a single refresh.
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it("setToken updates subsequent requests' Authorization header", async () => {
    const fetchImpl = scriptFetch([
      { status: 200, body: "{}" },
      { status: 200, body: "{}" },
    ]);
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    await client.request("https://api.github.com/x");
    client.setToken("tok-2");
    await client.request("https://api.github.com/y");
    const h0 = fetchImpl.calls[0]!.init!.headers as Record<string, string>;
    const h1 = fetchImpl.calls[1]!.init!.headers as Record<string, string>;
    expect(h0.Authorization).toBe("Bearer tok-1");
    expect(h1.Authorization).toBe("Bearer tok-2");
  });
});

describe("GitHubApiClient.request — rate-limit telemetry", () => {
  it("captures X-RateLimit-* headers off successful responses", async () => {
    const fetchImpl = scriptFetch([
      {
        status: 200,
        body: "{}",
        headers: {
          "X-RateLimit-Remaining": "4500",
          "X-RateLimit-Reset": "1700000000",
        },
      },
    ]);
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    await client.request("https://api.github.com/x");
    expect(client.getRateLimit()).toEqual({
      remaining: 4500,
      resetAt: 1_700_000_000_000,
    });
  });

  it("fires the listener once per reset window when remaining drops below the threshold", async () => {
    const fetchImpl = scriptFetch([
      {
        status: 200,
        body: "{}",
        headers: {
          "X-RateLimit-Remaining": "50",
          "X-RateLimit-Reset": "1700000000",
        },
      },
      {
        status: 200,
        body: "{}",
        headers: {
          "X-RateLimit-Remaining": "20",
          "X-RateLimit-Reset": "1700000000",
        },
      },
      {
        status: 200,
        body: "{}",
        headers: {
          "X-RateLimit-Remaining": "10",
          "X-RateLimit-Reset": "1700003600", // new window
        },
      },
    ]);
    const client = createGitHubApiClient("tok-1", { fetchImpl, rateLimitWarnAt: 100 });
    const listener = vi.fn();
    client.setRateLimitListener(listener);
    await client.request("https://api.github.com/a");
    await client.request("https://api.github.com/b");
    await client.request("https://api.github.com/c");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, {
      remaining: 50,
      resetAt: 1_700_000_000_000,
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      remaining: 10,
      resetAt: 1_700_003_600_000,
    });
  });

  it("does not fire the listener when remaining stays above the threshold", async () => {
    const fetchImpl = scriptFetch([
      {
        status: 200,
        body: "{}",
        headers: {
          "X-RateLimit-Remaining": "4500",
          "X-RateLimit-Reset": "1700000000",
        },
      },
    ]);
    const client = createGitHubApiClient("tok-1", { fetchImpl, rateLimitWarnAt: 100 });
    const listener = vi.fn();
    client.setRateLimitListener(listener);
    await client.request("https://api.github.com/x");
    expect(listener).not.toHaveBeenCalled();
  });

  it("listener throws are swallowed so they don't break the request", async () => {
    const fetchImpl = scriptFetch([
      {
        status: 200,
        body: "{}",
        headers: {
          "X-RateLimit-Remaining": "10",
          "X-RateLimit-Reset": "1700000000",
        },
      },
    ]);
    const client = createGitHubApiClient("tok-1", { fetchImpl, rateLimitWarnAt: 100 });
    client.setRateLimitListener(() => {
      throw new Error("UI bug");
    });
    // Resolves without throwing.
    await expect(client.request("https://api.github.com/x")).resolves.toBeDefined();
  });
});

describe("GitHubApiClient.requestOrNull", () => {
  it("returns the response on success", async () => {
    const fetchImpl = scriptFetch([{ status: 200, body: "{}" }]);
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    const resp = await client.requestOrNull("https://api.github.com/x");
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(200);
  });

  it("returns null on non-2xx (no throw)", async () => {
    const fetchImpl = scriptFetch([{ status: 404, body: "{}" }]);
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    const resp = await client.requestOrNull("https://api.github.com/x");
    expect(resp).toBeNull();
  });

  it("returns null when fetch itself rejects", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("network down"));
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    const resp = await client.requestOrNull("https://api.github.com/x");
    expect(resp).toBeNull();
  });

  it("retries on 401 with a refreshed token (same semantics as request)", async () => {
    const fetchImpl = scriptFetch([
      { status: 401, body: "{}" },
      { status: 200, body: "{}" },
    ]);
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    client.setTokenRefresher(async () => "tok-fresh");
    const resp = await client.requestOrNull("https://api.github.com/x");
    expect(resp!.status).toBe(200);
  });

  it("returns null when 401 retry also fails", async () => {
    const fetchImpl = scriptFetch([
      { status: 401, body: "{}" },
      { status: 500, body: "{}" },
    ]);
    const client = createGitHubApiClient("tok-1", { fetchImpl });
    client.setTokenRefresher(async () => "tok-fresh");
    const resp = await client.requestOrNull("https://api.github.com/x");
    expect(resp).toBeNull();
  });
});
