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
 * In-memory R2Bucket stub. Supports `head` / `get` / `put` /
 * `delete` / `list`. Body bytes stored as `ArrayBuffer`. Custom
 * metadata + httpMetadata round-tripped per-key. Sufficient for
 * the Phase 4c/4d upload + retrieval round-trip tests.
 *
 * Phase 4a (this PR) only uses `head` for the binding probe.
 */
export function makeMockR2(): R2Bucket {
  interface Entry {
    body: ArrayBuffer;
    customMetadata: Record<string, string>;
    httpMetadata: R2HTTPMetadata;
  }
  const store = new Map<string, Entry>();

  function makeObject(key: string, entry: Entry, includeBody: boolean): R2Object | R2ObjectBody {
    const base = {
      key,
      version: "test-version",
      size: entry.body.byteLength,
      etag: `test-etag-${key}`,
      httpEtag: `"test-etag-${key}"`,
      checksums: {} as R2Checksums,
      uploaded: new Date(),
      httpMetadata: entry.httpMetadata,
      customMetadata: entry.customMetadata,
      range: undefined,
      storageClass: "Standard",
      ssecKeyMd5: undefined,
      writeHttpMetadata(_headers: Headers) {
        /* no-op in tests */
      },
    };
    if (!includeBody) return base as unknown as R2Object;
    const text = () => new TextDecoder().decode(entry.body);
    return {
      ...base,
      get body() {
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(entry.body));
            controller.close();
          },
        });
      },
      bodyUsed: false,
      async arrayBuffer() {
        return entry.body;
      },
      async text() {
        return text();
      },
      async json<T>() {
        return JSON.parse(text()) as T;
      },
      async blob() {
        return new Blob([entry.body]);
      },
      async bytes() {
        return new Uint8Array(entry.body);
      },
    } as unknown as R2ObjectBody;
  }

  const mock = {
    async head(key: string): Promise<R2Object | null> {
      const entry = store.get(key);
      if (!entry) return null;
      return makeObject(key, entry, false) as R2Object;
    },
    async get(key: string): Promise<R2ObjectBody | null> {
      const entry = store.get(key);
      if (!entry) return null;
      return makeObject(key, entry, true) as R2ObjectBody;
    },
    async put(
      key: string,
      value: ArrayBuffer | ArrayBufferView | string | null | Blob,
      options?: R2PutOptions,
    ): Promise<R2Object> {
      let body: ArrayBuffer;
      if (value === null) {
        body = new ArrayBuffer(0);
      } else if (typeof value === "string") {
        body = new TextEncoder().encode(value).buffer as ArrayBuffer;
      } else if (value instanceof ArrayBuffer) {
        body = value;
      } else if (ArrayBuffer.isView(value)) {
        body = value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength,
        ) as ArrayBuffer;
      } else {
        // Blob
        body = await value.arrayBuffer();
      }
      const entry: Entry = {
        body,
        customMetadata: options?.customMetadata ?? {},
        httpMetadata: (options?.httpMetadata as R2HTTPMetadata | undefined) ?? {},
      };
      store.set(key, entry);
      return makeObject(key, entry, false) as R2Object;
    },
    async delete(key: string | string[]): Promise<void> {
      if (Array.isArray(key)) {
        for (const k of key) store.delete(k);
      } else {
        store.delete(key);
      }
    },
    async list(options?: R2ListOptions): Promise<R2Objects> {
      const prefix = options?.prefix ?? "";
      const matching = Array.from(store.entries())
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b));
      const objects = matching.map(([k, e]) => makeObject(k, e, false) as R2Object);
      return {
        objects,
        truncated: false,
        delimitedPrefixes: [],
      } as unknown as R2Objects;
    },
  };
  return mock as unknown as R2Bucket;
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
    OBJECTS: makeMockR2(),
    // Test-only OAuth credentials. Real values are set via
    // `wrangler secret put` at deploy time; these defaults let
    // the handlers run end-to-end in unit tests.
    GITHUB_OAUTH_CLIENT_ID: "test-client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "test-client-secret",
    GOOGLE_OAUTH_CLIENT_ID: "test-google-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-google-client-secret",
    // Test-only GitHub App credentials (5y-1). The PEM is the
    // shortest possible RSA private key for unit-test consumers
    // that just need a non-empty string; tests that exercise
    // real JWT signing land in 5y-2 and use a freshly-generated
    // key fixture.
    GITHUB_APP_ID: "123456",
    GITHUB_APP_CLIENT_ID: "test-app-client-id",
    GITHUB_APP_CLIENT_SECRET: "test-app-client-secret",
    GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n",
    GITHUB_APP_WEBHOOK_SECRET: "test-webhook-secret",
    // EMBED_SHELL_BUNDLE_URL stays optional + unset so the
    // worker's default-relative path is exercised; tests that
    // care override it explicitly.
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
