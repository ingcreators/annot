// `@ingcreators/annot-worker` — Cloudflare Worker hosting Annot's
// API surface.
//
// Current state (Phase 3c):
//   - /api/health                  (liveness probe)
//   - /api/health/bindings         (KV + D1 reachability check)
//   - /api/auth/github             (start GitHub OAuth)
//   - /api/auth/github/callback    (finish GitHub OAuth)
//   - /api/auth/google             (start Google OAuth)
//   - /api/auth/google/callback    (finish Google OAuth)
//   - /api/auth/me                 (current user from session)
//   - /api/auth/logout             (invalidate session)
//   - SESSIONS (KV) + DB (D1) bindings wired
//   - users / workspaces / workspace_members tables (Phase 3a)
//   - GITHUB_OAUTH_CLIENT_ID / _SECRET secrets read from c.env
//   - GOOGLE_OAUTH_CLIENT_ID / _SECRET secrets read from c.env
//
// Subsequent phases add:
//   Phase 4:  /api/images/* + /api/documents/* (AnnotCloudStore)
//   Phase 5:  /api/shares/* + /share/:token + /embed/:token
//   Phase 7:  /api/billing/* + /api/webhooks/stripe (private repo
//             integration)
//
// See `docs/plans/annot-cloud-roadmap.md` for the full sequence.

import { Hono } from "hono";
import { handleGithubCallback, handleGithubStart } from "./auth-github.js";
import { handleGoogleCallback, handleGoogleStart } from "./auth-google.js";
import { handleAuthLogout, handleAuthMe } from "./auth-me.js";

/**
 * Environment bindings for the Worker. Each entry corresponds
 * to a `[[kv_namespaces]]` / `[[d1_databases]]` / `[[r2_buckets]]`
 * entry in `wrangler.jsonc`, or a secret set via
 * `wrangler secret put`.
 *
 * Phase 3c (this PR) adds the `GOOGLE_OAUTH_CLIENT_ID` and
 * `GOOGLE_OAUTH_CLIENT_SECRET` secrets. Subsequent phases:
 *   Phase 4:  OBJECTS (R2Bucket) — image / document bytes
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
  /**
   * GitHub OAuth App client ID. Public (gets baked into the
   * authorize URL); declared as a Worker secret only to keep all
   * OAuth credentials in one wrangler.secret namespace.
   * Set via `wrangler secret put GITHUB_OAUTH_CLIENT_ID`.
   */
  GITHUB_OAUTH_CLIENT_ID: string;
  /**
   * GitHub OAuth App client secret. Required for the
   * `code → access_token` exchange. NEVER exposed to the browser.
   * Set via `wrangler secret put GITHUB_OAUTH_CLIENT_SECRET`.
   */
  GITHUB_OAUTH_CLIENT_SECRET: string;
  /**
   * Google OAuth Client ID. Public (gets baked into the
   * authorize URL). Set via
   * `wrangler secret put GOOGLE_OAUTH_CLIENT_ID`.
   */
  GOOGLE_OAUTH_CLIENT_ID: string;
  /**
   * Google OAuth Client Secret. Required for the
   * `code → access_token` exchange. Set via
   * `wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET`.
   */
  GOOGLE_OAUTH_CLIENT_SECRET: string;
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

// ─── Auth — GitHub OAuth ─────────────────────────────────────
app.get("/api/auth/github", handleGithubStart);
app.get("/api/auth/github/callback", handleGithubCallback);

// ─── Auth — Google OAuth ─────────────────────────────────────
app.get("/api/auth/google", handleGoogleStart);
app.get("/api/auth/google/callback", handleGoogleCallback);

// ─── Auth — session introspection / invalidation ─────────────
app.get("/api/auth/me", handleAuthMe);
app.post("/api/auth/logout", handleAuthLogout);

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
