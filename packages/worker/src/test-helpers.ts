// Test helpers — minimal mock implementations of Cloudflare
// runtime bindings sufficient for unit-testing the Worker's
// handlers. NOT production-grade; just enough surface for
// vitest invocations via `app.request(path, init, mockEnv)`.
//
// Phase 4 will likely move binding-aware tests onto
// `@cloudflare/vitest-pool-workers` (real bindings inside a
// miniflare environment); these mocks stay as fast smoke
// fixtures for handler-level tests that don't need
// transaction semantics or persistence.
//
// File suffix is `.ts` (not `.test-mock.ts`) because the helpers
// are pure types + factories — they don't ship Vitest fixtures.

import type { Env } from "./index.js";

/**
 * In-memory KVNamespace stub. Supports `get` / `put` / `delete`
 * with TTL ignored — sufficient for OAuth state + session round-
 * trip tests, which run synchronously in one process.
 */
export function makeMockKv(seed: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(seed));

  // The KVNamespace type has a wide method surface; we implement
  // only what the worker actually calls and cast through unknown.
  const mock = {
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list() {
      return {
        keys: Array.from(store.keys()).map((name) => ({ name })),
        list_complete: true as const,
        cursor: "",
      };
    },
  };
  return mock as unknown as KVNamespace;
}

/**
 * Minimal D1Database stub. Only supports the queries the worker
 * actually issues for binding-probe smoke checks. Phase 3+ tests
 * that need real schema introspection will graduate onto a
 * miniflare-backed D1 instance.
 */
export function makeMockD1(): D1Database {
  const mock = {
    prepare(_query: string) {
      return {
        async first<T = unknown>(): Promise<T | null> {
          // The Phase 2b health probe runs
          //   SELECT 1 FROM sqlite_master LIMIT 1
          // — return a row so the probe reports "db: ok".
          return { 1: 1 } as unknown as T;
        },
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
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  };
  return mock as unknown as D1Database;
}

/**
 * Construct a complete mock Env. Override individual bindings
 * or secrets via the optional `overrides` to test failure paths
 * (e.g. an unset `GITHUB_OAUTH_CLIENT_ID` via `{ GITHUB_OAUTH_CLIENT_ID:
 * "" }`).
 */
export function makeMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    SESSIONS: makeMockKv(),
    DB: makeMockD1(),
    // Test-only OAuth credentials. Real values are set via
    // `wrangler secret put` at deploy time; these defaults let
    // the handlers run end-to-end in unit tests.
    GITHUB_OAUTH_CLIENT_ID: "test-client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "test-client-secret",
    ...overrides,
  };
}
