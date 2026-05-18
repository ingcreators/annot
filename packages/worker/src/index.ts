// `@ingcreators/annot-worker` — Cloudflare Worker hosting Annot's
// API surface.
//
// Current state (Phase 5):
//   - /api/health                            (liveness probe)
//   - /api/health/bindings                   (KV + D1 + R2 reachability)
//   - /api/auth/github + /github/callback    (GitHub OAuth)
//   - /api/auth/google + /google/callback    (Google OAuth)
//   - /api/auth/me                           (current user from session)
//   - /api/auth/logout                       (invalidate session)
//   - /api/images                            (POST upload, GET list)
//   - /api/images/:id                        (GET / PATCH / DELETE metadata)
//   - /api/images/:id/original               (GET original bytes)
//   - /api/images/:id/annotations            (GET + PATCH annotations SVG)
//   - /api/documents                         (POST upload, GET list)
//   - /api/documents/:id                     (GET / PATCH / DELETE metadata)
//   - /api/documents/:id/content             (GET + PATCH document bytes)
//   - /api/usage                             (workspace plan + quota usage)
//   - /api/shares                            (POST create, GET list)
//   - /api/shares/:token                     (GET public, DELETE revoke)
//   - /api/shares/:token/payload             (GET public bytes)
//   - per-workspace plan-gated quotas on POST /api/images, POST
//     /api/documents, PATCH /api/documents/:id/content, POST
//     /api/shares (Phase 4e + 5)
//   - SESSIONS (KV) + DB (D1) + OBJECTS (R2) bindings wired
//   - users / workspaces / workspace_members tables (Phase 3a)
//   - images / documents / audit_events tables (Phase 4b)
//   - share_links table (Phase 5)
//   - GITHUB_OAUTH_CLIENT_ID / _SECRET secrets
//   - GOOGLE_OAUTH_CLIENT_ID / _SECRET secrets
//   Phase 5:  /api/shares/* + /share/:token + /embed/:token
//   Phase 7:  /api/billing/* + /api/webhooks/stripe (private repo
//             integration)
//
// See `docs/plans/annot-cloud-roadmap.md` for the full sequence.

import { Hono } from "hono";
import { handleGithubCallback, handleGithubStart } from "./auth-github.js";
import { handleGoogleCallback, handleGoogleStart } from "./auth-google.js";
import { handleAuthLogout, handleAuthMe } from "./auth-me.js";
import {
  handleDocumentContentGet,
  handleDocumentContentPatch,
  handleDocumentDelete,
  handleDocumentGet,
  handleDocumentList,
  handleDocumentPatch,
  handleDocumentUpload,
} from "./documents.js";
import {
  handleImageAnnotationsGet,
  handleImageAnnotationsPatch,
  handleImageDelete,
  handleImageGet,
  handleImageList,
  handleImageOriginalGet,
  handleImagePatch,
  handleImageUpload,
} from "./images.js";
import {
  handleShareCreate,
  handleShareGet,
  handleShareList,
  handleSharePayload,
  handleShareRevoke,
} from "./shares.js";
import { handleUsageGet } from "./usage.js";

/**
 * Environment bindings for the Worker. Each entry corresponds
 * to a `[[kv_namespaces]]` / `[[d1_databases]]` / `[[r2_buckets]]`
 * entry in `wrangler.jsonc`, or a secret set via
 * `wrangler secret put`.
 *
 * Phase 4a (this PR) adds the `OBJECTS` R2 bucket binding.
 * Subsequent phases:
 *   Phase 4b: D1 migration adds tables; OBJECTS gets keys
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
   * Object storage for image bytes, annotation SVGs, document
   * bytes (`.annot.html`), and thumbnails. R2's no-egress-cost
   * pricing model is what makes the free tier financially
   * viable; S3 / GCS egress costs would dominate as users view
   * shared screenshots repeatedly.
   *
   * Phase 4a (this PR) just wires the binding. Phase 4c/4d add
   * the endpoints that write keys to this bucket; key layout
   * (decided in Phase 4c): `<workspace_id>/images/<image_id>/...`
   * for namespacing per-workspace.
   */
  OBJECTS: R2Bucket;
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
 * Bindings smoke check. Verifies SESSIONS (KV), DB (D1), and
 * OBJECTS (R2) are configured and reachable by issuing a no-op
 * probe against each. Returns 200 with `{ kv: "ok", db: "ok",
 * r2: "ok" }` on success.
 *
 * Used for:
 * - Post-deploy verification that wrangler.jsonc bindings
 *   resolve to real Cloudflare resources.
 * - Smoke-checking after a binding migration.
 *
 * NOT used for application-level health. The endpoint
 * deliberately stays low-fidelity (each probe is a cheap no-op
 * call) to remain useful as the schema grows.
 */
app.get("/api/health/bindings", async (c) => {
  const checks: {
    kv: "ok" | "error";
    db: "ok" | "error";
    r2: "ok" | "error";
  } = {
    kv: "error",
    db: "error",
    r2: "error",
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

  try {
    // R2: a `.head` against a definitely-missing key returns
    // null without throwing. Proves the binding is reachable
    // and the bucket exists.
    await c.env.OBJECTS.head("__health-probe__");
    checks.r2 = "ok";
  } catch (err) {
    errors.r2 = err instanceof Error ? err.message : String(err);
  }

  const allOk = checks.kv === "ok" && checks.db === "ok" && checks.r2 === "ok";
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

// ─── Images (AnnotCloudStore) ────────────────────────────────
app.post("/api/images", handleImageUpload);
app.get("/api/images", handleImageList);
app.get("/api/images/:id", handleImageGet);
app.patch("/api/images/:id", handleImagePatch);
app.delete("/api/images/:id", handleImageDelete);
app.get("/api/images/:id/original", handleImageOriginalGet);
app.get("/api/images/:id/annotations", handleImageAnnotationsGet);
app.patch("/api/images/:id/annotations", handleImageAnnotationsPatch);

// ─── Documents (AnnotCloudStore — .annot.html) ───────────────
app.post("/api/documents", handleDocumentUpload);
app.get("/api/documents", handleDocumentList);
app.get("/api/documents/:id", handleDocumentGet);
app.patch("/api/documents/:id", handleDocumentPatch);
app.delete("/api/documents/:id", handleDocumentDelete);
app.get("/api/documents/:id/content", handleDocumentContentGet);
app.patch("/api/documents/:id/content", handleDocumentContentPatch);

// ─── Plan / quota introspection ──────────────────────────────
app.get("/api/usage", handleUsageGet);

// ─── Shares (public link + embed) ────────────────────────────
app.post("/api/shares", handleShareCreate);
app.get("/api/shares", handleShareList);
app.get("/api/shares/:token", handleShareGet);
app.delete("/api/shares/:token", handleShareRevoke);
app.get("/api/shares/:token/payload", handleSharePayload);

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
