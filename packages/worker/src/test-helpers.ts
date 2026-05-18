// Test helpers — mock implementations of Cloudflare runtime
// bindings sufficient for unit-testing the Worker's handlers.
// NOT production code; the file lives under `src/` so its imports
// resolve under the same tsconfig, but it's only consumed from
// `*.test.ts` files.
//
// Two flavours of D1 mock exist:
//   - `makeMockD1`              static stub (returns the same row
//                                for any query). Used by tests
//                                that just need the binding to be
//                                callable (e.g. health probe).
//   - `makeMockD1Sqlite`        real in-memory SQLite via
//                                `better-sqlite3`, wrapped in the
//                                D1Database interface and seeded
//                                from the migrations directory.
//                                Use this for user-repo / DB-aware
//                                tests so SQL syntax + constraint
//                                violations are caught at test time.
//
// Phase 4 may graduate to `@cloudflare/vitest-pool-workers`
// (real bindings inside a miniflare environment) if the SQLite
// approximation becomes the bottleneck; these mocks stay as
// fast handler-level coverage either way.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Sqlite from "better-sqlite3";
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
    GOOGLE_OAUTH_CLIENT_ID: "test-google-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-google-client-secret",
    ...overrides,
  };
}

// ─── SQLite-backed D1 mock ───────────────────────────────────────
//
// `makeMockD1Sqlite()` returns a D1Database-shaped object backed
// by `better-sqlite3` (real in-memory SQLite). All migration SQL
// files under `packages/worker/migrations/` are applied on
// construction so the test database mirrors the production
// schema. Use this for user-repo and other DB-aware tests where
// real SQL semantics (UNIQUE constraints, NULL handling, etc.)
// matter.
//
// Limitations vs real D1:
//   - No network round-trip; everything is synchronous under the
//     hood. The wrapper async-ifies the surface to match D1.
//   - No multi-statement BEGIN/COMMIT transactions exposed via
//     `.batch()`; we approximate by running statements in order.
//   - `meta.last_row_id` returns better-sqlite3's lastInsertRowid
//     for inserts; D1 also exposes this. Same shape.

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

/**
 * Construct a fresh in-memory SQLite database with all migrations
 * applied. Returned as a D1Database-shaped object so the same
 * code that talks to the real D1 binding in production can be
 * exercised against this in tests.
 */
export function makeMockD1Sqlite(): D1Database {
  const sqlite = new Sqlite(":memory:");
  // Match D1's default behaviour: foreign-key constraints are
  // declared but NOT enforced. Cloudflare D1 doesn't run
  // `PRAGMA foreign_keys = ON` automatically, and our migrations
  // intentionally treat `REFERENCES` clauses as documentation.
  // If a future migration starts relying on cascade-delete, we
  // can flip this and update D1-side runtime expectations together.
  sqlite.pragma("foreign_keys = OFF");
  applyMigrations(sqlite);
  return wrapSqliteAsD1(sqlite);
}

function applyMigrations(sqlite: Sqlite.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    sqlite.exec(sql);
  }
}

function wrapSqliteAsD1(sqlite: Sqlite.Database): D1Database {
  function prepare(query: string): unknown {
    const stmt = sqlite.prepare(query);
    let boundArgs: unknown[] = [];
    const api = {
      bind(...args: unknown[]) {
        boundArgs = args;
        return api;
      },
      async first<T = unknown>(): Promise<T | null> {
        const row = stmt.get(...(boundArgs as never[]));
        return (row as T | undefined) ?? null;
      },
      async all() {
        const results = stmt.all(...(boundArgs as never[]));
        return {
          results,
          success: true as const,
          meta: { duration: 0, rows_read: results.length, rows_written: 0 },
        };
      },
      async run() {
        const info = stmt.run(...(boundArgs as never[]));
        return {
          success: true as const,
          meta: {
            changes: info.changes,
            last_row_id: Number(info.lastInsertRowid),
            duration: 0,
            rows_read: 0,
            rows_written: info.changes,
          },
        };
      },
      async raw() {
        return stmt.raw().all(...(boundArgs as never[])) as unknown[];
      },
    };
    return api;
  }

  const mock = {
    prepare,
    async batch<T>(statements: unknown[]): Promise<T[]> {
      const out: unknown[] = [];
      for (const s of statements) {
        // `batch` accepts the prepared statements returned by
        // `prepare(...).bind(...)`. We just sequentially `run`
        // them; the SQLite native lib handles statement reuse.
        const result = await (s as { run(): Promise<unknown> }).run();
        out.push(result);
      }
      return out as T[];
    },
    async exec(query: string) {
      const startedAt = Date.now();
      sqlite.exec(query);
      return { count: 1, duration: Date.now() - startedAt };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  };
  return mock as unknown as D1Database;
}
