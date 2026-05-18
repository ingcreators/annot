// Auth helper — shared between every endpoint that needs to know
// who's calling. Phase 4c extracts this from `auth-me.ts` so
// `/api/images/*` and (Phase 4d) `/api/documents/*` can reuse the
// same cookie → session → workspace lookup.

import type { Context } from "hono";
import type { Env } from "./index.js";
import { loadSession, readSessionCookie, type SessionRecord } from "./session.js";

/**
 * Authenticated request context. `session` is the full KV record;
 * `userId` and `workspaceId` are convenience non-null aliases (the
 * Phase 3 `findOrCreateUserFromProvider` upsert guarantees both
 * are present in any session minted from Phase 3 onwards).
 */
export interface AuthContext {
  session: SessionRecord;
  userId: string;
  workspaceId: string;
}

/**
 * Load the session from the request cookie and verify Phase-3
 * fields are present. Returns either the context for handlers
 * to consume, or a fully-built `Response` (401) the handler
 * should return verbatim.
 *
 * The "or-response" pattern keeps Hono's typing simple — no
 * middleware-set context vars needed.
 *
 * Error cases (the returned Response carries the matching code):
 *   - 401 `no_session`              — cookie absent
 *   - 401 `expired_session`         — cookie present but KV record gone
 *   - 401 `legacy_session_relogin_required`
 *                                    — pre-Phase-3 session missing
 *                                      userId / workspaceId
 */
export async function requireAuth(c: Context<{ Bindings: Env }>): Promise<AuthContext | Response> {
  const token = readSessionCookie(c.req.header("Cookie") ?? null);
  if (!token) {
    return c.json({ ok: false, error: "no_session", message: "No session cookie." }, 401);
  }
  const session = await loadSession(c.env.SESSIONS, token);
  if (!session) {
    return c.json(
      {
        ok: false,
        error: "expired_session",
        message: "Session cookie present but the record is missing or expired.",
      },
      401,
    );
  }
  if (!session.userId || !session.workspaceId) {
    // Pre-Phase-3 session: KV record was minted before the OAuth
    // callback started upserting to D1. The user must sign in
    // again to populate the workspace context.
    return c.json(
      {
        ok: false,
        error: "legacy_session_relogin_required",
        message:
          "Your session was created before per-workspace endpoints were " +
          "available. Sign in again to continue.",
      },
      401,
    );
  }
  return {
    session,
    userId: session.userId,
    workspaceId: session.workspaceId,
  };
}
