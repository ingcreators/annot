// `@ingcreators/annot-worker` — Cloudflare Worker hosting Annot's
// API surface.
//
// Phase 2a (this scaffold): single `/api/health` endpoint to prove
// the Worker deploys and routes correctly. Subsequent phases add:
//
//   Phase 2b: KV + D1 bindings (no endpoints yet, just wiring)
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

// Note: an `Env` interface for environment bindings (KV / D1 / R2
// / secrets) lands in Phase 2b alongside the first binding.
// Phase 2a needs no bindings, so the Hono generic is left at its
// default. Bindings to land in subsequent phases:
//   Phase 2b: SESSIONS (KVNamespace) — OAuth state + sessions
//   Phase 3:  DB (D1Database) — multi-tenant schema
//   Phase 4:  OBJECTS (R2Bucket) — image / document bytes
//   Phase 2c: GITHUB_OAUTH_CLIENT_ID / _SECRET secrets
//   Phase 3:  GOOGLE_OAUTH_CLIENT_ID / _SECRET secrets
//   Phase 7:  STRIPE_SECRET_KEY / _WEBHOOK_SECRET secrets

const app = new Hono();

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
