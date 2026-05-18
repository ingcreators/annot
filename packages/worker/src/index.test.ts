// Worker smoke tests. Uses Hono's `app.request()` to invoke
// handlers directly without booting `miniflare` / `wrangler dev`.
// Phase 2b adds binding-aware tests via in-memory mocks
// (`test-helpers.ts`). Phase 4 may graduate the binding-aware
// paths onto `@cloudflare/vitest-pool-workers` if mock fidelity
// becomes the bottleneck; today's mocks are sufficient for the
// handler-level coverage we need.

import { describe, expect, it } from "vitest";
import app from "./index.js";
import { makeMockD1, makeMockEnv, makeMockKv } from "./test-helpers.js";

describe("/api/health", () => {
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

describe("/api/health/bindings", () => {
  it("returns 200 + ok:true when KV and D1 are reachable", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/health/bindings", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      kv: string;
      db: string;
    };
    expect(body.ok).toBe(true);
    expect(body.kv).toBe("ok");
    expect(body.db).toBe("ok");
  });

  it("returns 503 + errors when the KV binding fails", async () => {
    const env = makeMockEnv({
      SESSIONS: {
        async get() {
          throw new Error("KV unreachable");
        },
      } as unknown as KVNamespace,
    });
    const res = await app.request("/api/health/bindings", {}, env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok: boolean;
      kv: string;
      db: string;
      errors?: Record<string, string>;
    };
    expect(body.ok).toBe(false);
    expect(body.kv).toBe("error");
    expect(body.db).toBe("ok");
    expect(body.errors?.kv).toContain("KV unreachable");
  });

  it("returns 503 + errors when the DB binding fails", async () => {
    const env = makeMockEnv({
      DB: {
        prepare() {
          return {
            async first() {
              throw new Error("D1 down");
            },
            // Stubbed so the typecheck for the prepare statement
            // shape is satisfied; not exercised in this test.
            async all() {
              return { results: [], success: true as const, meta: {} };
            },
            async run() {
              return {
                success: true as const,
                meta: { changes: 0, last_row_id: 0 },
              };
            },
            bind(..._args: unknown[]) {
              return this;
            },
          };
        },
      } as unknown as D1Database,
    });
    const res = await app.request("/api/health/bindings", {}, env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok: boolean;
      kv: string;
      db: string;
      errors?: Record<string, string>;
    };
    expect(body.ok).toBe(false);
    expect(body.kv).toBe("ok");
    expect(body.db).toBe("error");
    expect(body.errors?.db).toContain("D1 down");
  });
});

describe("test helpers themselves", () => {
  it("makeMockKv supports get/put/delete round-trip", async () => {
    const kv = makeMockKv({ existing: "value" });
    expect(await kv.get("existing")).toBe("value");
    expect(await kv.get("missing")).toBeNull();
    await kv.put("fresh", "new-value");
    expect(await kv.get("fresh")).toBe("new-value");
    await kv.delete("existing");
    expect(await kv.get("existing")).toBeNull();
  });

  it("makeMockD1 prepare().first() returns a placeholder row", async () => {
    const db = makeMockD1();
    const row = await db.prepare("SELECT 1").first();
    expect(row).not.toBeNull();
  });
});

describe("404 fallback", () => {
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
