// `@ingcreators/annot-worker` — Cloudflare Worker hosting Annot's
// API surface.
//
// Current state (Phase 2b):
//   - /api/health           (liveness probe)
//   - /api/health/bindings  (KV + D1 reachability check)
//   - SESSIONS (KV) + DB (D1) bindings wired
//
// Subsequent phases add:
//   Phase 2c: /api/auth/github + /api/auth/github/callback
//             /api/auth/me + /api/auth/logout
//   Phase 3:  /api/auth/google + Google OAuth callback
//             /api/auth/session refresh
//   Phase 4:  /api/images/* + /api/documents/* (AnnotCloudStore)
//   Phase 5:  /api/shares/* + /share/:token + /embed/:token
//   Phase 7:  /api/billing/* + /api/webhooks/stripe (private repo
//             integration)
//
// See `docs/plans/annot-cloud-roadmap.md` for the full sequence.

import { Hono } from "hono";

/**
 * Environment bindings for the Worker. Each entry corresponds
 * to a `[[kv_namespaces]]` / `[[d1_databases]]` / `[[r2_buckets]]`
 * entry in `wrangler.toml`, or a secret set via
 * `wrangler secret put`.
 *
 * Phase 2b (this PR) adds `SESSIONS` (KV) and `DB` (D1).
 * Subsequent phases extend this:
 *   Phase 4:  OBJECTS (R2Bucket) — image / document bytes
 *   Phase 2c: GITHUB_OAUTH_CLIENT_ID / _SECRET secrets
 *   Phase 3:  GOOGLE_OAUTH_CLIENT_ID / _SECRET secrets
 *   Phase 7:  STRIPE_SECRET_KEY / _WEBHOOK_SECRET secrets
 */
export interface Env {
  /**
   * Session cookies + OAuth CSRF state. Short-TTL keys
   * (`oauth-state:*` for 10 min, `session:*` for 30 days).
   */
  SESSIONS: KVNamespace;
  /**
   * Multi-tenant SQLite. Schema lands in Phase 3 (`users`,
   * `workspaces`, `workspace_members`); Phase 2b only wires the
   * binding so subsequent phases can drop in `CREATE TABLE`s
   * without re-touching the wrangler config.
   */
  DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>();

/**
 * Liveness probe. Returns 200 with a small JSON body so the
 * caller can confirm both that the Worker is reachable AND that
 * its TypeScript / Hono runtime survived the build. Health checks
 * are intentionally cheap — no DB lookup, no KV read.
 */
app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "annot-api",
    timestamp: new Date().toISOString(),
  }),
);

/**
 * Bindings smoke check. Verifies SESSIONS (KV) and DB (D1) are
 * configured and reachable by issuing a no-op probe against each.
 * Returns 200 with `{ kv: "ok", db: "ok" }` on success.
 *
 * Used for:
 * - Post-deploy verification that wrangler.toml IDs are correctly
 *   replaced from `<placeholder>` to real Cloudflare resource IDs.
 * - Smoke-checking after a binding migration.
 *
 * NOT used for application-level health (the `DB` schema is empty
 * in Phase 2b, so we can't probe for app data yet). The endpoint
 * deliberately stays low-fidelity to remain useful as the schema
 * grows.
 */
app.get("/api/health/bindings", async (c) => {
  const checks: { kv: "ok" | "error"; db: "ok" | "error" } = {
    kv: "error",
    db: "error",
  };
  const errors: Record<string, string> = {};

  try {
    // KV: a `.get` against a definitely-missing key returns null
    // without throwing. Proves the binding is reachable.
    await c.env.SESSIONS.get("__health-probe__");
    checks.kv = "ok";
  } catch (err) {
    errors.kv = err instanceof Error ? err.message : String(err);
  }

  try {
    // D1: a SELECT against a built-in metadata table works even
    // when no user tables exist. `sqlite_master` is available on
    // every D1 instance.
    await c.env.DB.prepare("SELECT 1 FROM sqlite_master LIMIT 1").first();
    checks.db = "ok";
  } catch (err) {
    errors.db = err instanceof Error ? err.message : String(err);
  }

  const allOk = checks.kv === "ok" && checks.db === "ok";
  return c.json(
    {
      ok: allOk,
      service: "annot-api",
      timestamp: new Date().toISOString(),
      ...checks,
      ...(Object.keys(errors).length > 0 ? { errors } : {}),
    },
    allOk ? 200 : 503,
  );
});

/**
 * Catch-all 404 so probes against an undefined route return a
 * predictable JSON shape instead of Hono's default plaintext.
 */
app.notFound((c) =>
  c.json(
    {
      ok: false,
      error: "not_found",
      message: `No handler for ${c.req.method} ${c.req.path}`,
    },
    404,
  ),
);

/**
 * Final-resort error handler. Catches anything a route handler
 * forgot to handle; returns a stable JSON shape clients can
 * detect. Logs to Workers Logs (observability enabled in
 * wrangler.toml) so post-mortem inspection works.
 */
app.onError((err, c) => {
  console.error("[annot-api] unhandled error", err);
  return c.json(
    {
      ok: false,
      error: "internal_error",
      message: err.message,
    },
    500,
  );
});

export default app;
