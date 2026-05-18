// Phase 2a smoke tests for the Worker. Uses Hono's `app.request()`
// to invoke handlers directly without booting `miniflare` /
// `wrangler dev`. Pure-function testing — once Phase 2b adds KV /
// D1 bindings, we'll switch to `@cloudflare/vitest-pool-workers`
// for the binding-aware paths and keep these as fast smoke tests.

import { describe, expect, it } from "vitest";
import app from "./index.js";

describe("Phase 2a — /api/health", () => {
  it("returns 200 with ok:true and service identifier", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      timestamp: string;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("annot-api");
    expect(typeof body.timestamp).toBe("string");
    // Loose ISO-8601 shape — the exact precision differs by
    // runtime; the prefix is the same.
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("responds with JSON content-type", async () => {
    const res = await app.request("/api/health");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });
});

describe("Phase 2a — 404 fallback", () => {
  it("returns JSON 404 for undefined routes", async () => {
    const res = await app.request("/api/nonexistent");
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      message: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("not_found");
    expect(body.message).toContain("/api/nonexistent");
  });

  it("returns JSON 404 for root path (no handler defined)", async () => {
    // The Worker doesn't serve "/" — that's the PWA's domain.
    // Probes against "/" land on the 404 handler.
    const res = await app.request("/");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("includes the HTTP method in the message", async () => {
    const res = await app.request("/api/missing", { method: "POST" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("POST");
  });
});
