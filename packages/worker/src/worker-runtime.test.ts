// Integration tests that run the worker inside the REAL workerd
// runtime (via Miniflare) against REAL D1 / KV / R2 bindings — the
// layer the better-sqlite3 unit tests can't prove: D1 SQL dialect,
// binding semantics, and workerd-only behaviour.
//
// The worker is esbuild-bundled once, booted in Miniflare with the
// same bindings + compat flags as `wrangler.jsonc`, the real
// `migrations/*.sql` applied to the workerd-backed D1, then driven
// end-to-end over HTTP via `dispatchFetch`. Sessions are seeded by
// running the SAME repo functions the OAuth callback uses, against
// the Miniflare bindings (shared storage with the worker isolate).
//
// This is a plain node-pool test — Miniflare embeds workerd — so the
// root `vitest run` + CI pick it up with no extra config. It's the
// slower "does it work on workerd" tier; the fast per-handler
// coverage stays in `images.test.ts` etc. against the SQLite mock.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "./session.js";
import { findOrCreateUserFromProvider } from "./user-repo.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(dir, "..", "migrations");
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const YAML = "version: 1\noverlays:\n  - ref: e2\n    intent: primary\n";

let mf: Miniflare;
let seedCounter = 0;

/** esbuild-bundle the worker entry into a single ESM module workerd
 *  can load. `cloudflare:*` are workerd built-ins; `node:*` come
 *  from the `nodejs_compat` flag — both stay as imports. */
async function bundleWorker(): Promise<string> {
  const result = await build({
    entryPoints: [path.join(dir, "index.ts")],
    bundle: true,
    format: "esm",
    write: false,
    platform: "neutral",
    conditions: ["workerd", "worker", "browser", "import", "module", "default"],
    mainFields: ["module", "main"],
    external: ["cloudflare:*", "node:*"],
    target: "esnext",
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
}

/** Apply the numbered migration files to the real D1 binding. Runs
 *  one statement at a time (D1's `exec` is picky about comments /
 *  multi-statement SQL); the migration SQL has no `;` inside string
 *  literals, so stripping `--` comments + splitting on `;` is safe. */
async function applyMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const raw = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const statements = raw
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await db.prepare(stmt).run();
    }
  }
}

/** Seed a fresh user + workspace + session directly against the
 *  Miniflare bindings (same code path the OAuth callback runs). Each
 *  call uses a distinct provider id so tests get isolated workspaces
 *  and never collide on image paths. */
async function seedSession(): Promise<{ cookie: string; workspaceId: string }> {
  seedCounter += 1;
  const db = (await mf.getD1Database("DB")) as unknown as D1Database;
  const kv = (await mf.getKVNamespace("SESSIONS")) as unknown as KVNamespace;
  const providerUserId = `runtime-user-${seedCounter}`;
  const upserted = await findOrCreateUserFromProvider(db, {
    provider: "github",
    providerUserId,
    email: null,
    displayName: "Runtime Test User",
    avatarUrl: "",
  });
  const now = new Date().toISOString();
  const token = await createSession(kv, {
    provider: "github",
    providerUserId,
    login: "runtime-user",
    name: "Runtime Test User",
    avatarUrl: "",
    createdAt: now,
    lastSeenAt: now,
    userId: upserted.user.id,
    workspaceId: upserted.workspace.id,
  });
  return { cookie: `annot_session=${token}`, workspaceId: upserted.workspace.id };
}

async function uploadImage(cookie: string, imgPath: string): Promise<string> {
  const res = await mf.dispatchFetch(
    `http://localhost/api/images?path=${encodeURIComponent(imgPath)}`,
    { method: "POST", headers: { Cookie: cookie, "Content-Type": "image/png" }, body: PNG_BYTES },
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { image: { id: string } };
  return body.image.id;
}

beforeAll(async () => {
  const script = await bundleWorker();
  mf = new Miniflare({
    modules: [{ type: "ESModule", path: "worker.mjs", contents: script }],
    compatibilityDate: "2026-05-01",
    compatibilityFlags: ["nodejs_compat"],
    kvNamespaces: ["SESSIONS"],
    d1Databases: ["DB"],
    r2Buckets: ["OBJECTS"],
  });
  await mf.ready;
  await applyMigrations((await mf.getD1Database("DB")) as unknown as D1Database);
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

describe("worker on workerd (Miniflare) — health", () => {
  it("GET /api/health returns ok", async () => {
    const res = await mf.dispatchFetch("http://localhost/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("annot-api");
  });

  it("GET /api/health/bindings reports every real binding reachable", async () => {
    const res = await mf.dispatchFetch("http://localhost/api/health/bindings");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});

describe("worker on workerd (Miniflare) — D1 migrations", () => {
  it("applied cleanly: the schema queries the real D1 without error", async () => {
    // If any migration failed to apply to real D1 (dialect quirk),
    // beforeAll would have thrown. This also proves the auth flow's
    // INSERTs run on real D1 — seedSession writes users + workspaces.
    const { cookie } = await seedSession();
    const me = await mf.dispatchFetch("http://localhost/api/auth/me", {
      headers: { Cookie: cookie },
    });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { ok: boolean; user: { workspaceId: string } };
    expect(body.ok).toBe(true);
    expect(body.user.workspaceId).toBeTruthy();
  });
});

describe("worker on workerd (Miniflare) — image + sidecar round-trips", () => {
  it("uploads an image (D1 row + R2 object) and reads it back", async () => {
    const { cookie } = await seedSession();
    const id = await uploadImage(cookie, "shot.png");

    const meta = await mf.dispatchFetch(`http://localhost/api/images/${id}`, {
      headers: { Cookie: cookie },
    });
    expect(meta.status).toBe(200);
    expect(((await meta.json()) as { image: { path: string } }).image.path).toBe("shot.png");

    const original = await mf.dispatchFetch(`http://localhost/api/images/${id}/original`, {
      headers: { Cookie: cookie },
    });
    expect(original.status).toBe(200);
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("annotations-yaml sidecar round-trips through real R2 (PR #1078)", async () => {
    const { cookie } = await seedSession();
    const id = await uploadImage(cookie, "spec.png");

    // 404 before any write.
    const before = await mf.dispatchFetch(`http://localhost/api/images/${id}/annotations-yaml`, {
      headers: { Cookie: cookie },
    });
    expect(before.status).toBe(404);

    const patch = await mf.dispatchFetch(`http://localhost/api/images/${id}/annotations-yaml`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "text/yaml" },
      body: YAML,
    });
    expect(patch.status).toBe(200);

    const after = await mf.dispatchFetch(`http://localhost/api/images/${id}/annotations-yaml`, {
      headers: { Cookie: cookie },
    });
    expect(after.status).toBe(200);
    expect(after.headers.get("Content-Type")).toBe("text/yaml; charset=utf-8");
    expect(await after.text()).toBe(YAML);
  });

  it("enforces workspace isolation on real D1 (other workspace → 404)", async () => {
    const a = await seedSession();
    const b = await seedSession();
    const id = await uploadImage(a.cookie, "private.png");
    // B's session can't see A's image id.
    const res = await mf.dispatchFetch(`http://localhost/api/images/${id}`, {
      headers: { Cookie: b.cookie },
    });
    expect(res.status).toBe(404);
  });
});
