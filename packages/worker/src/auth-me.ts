// `/api/auth/me` + `/api/auth/logout` — Phase 2c, extended in
// Phase 3 to surface `userId` / `workspaceId` and touch
// `users.last_seen_at`.
//
// `/me` reads the session cookie, looks up the KV record, and
// returns a small JSON envelope identifying the current user.
// Returns 401 (not 404) when no session exists so client code
// can route the "logged out" state distinctly from "endpoint
// missing".
//
// `/logout` invalidates the session in KV and clears the cookie.

import type { Context } from "hono";
import type { Env } from "./index.js";
import {
  buildClearedSessionCookie,
  deleteSession,
  loadSession,
  readSessionCookie,
} from "./session.js";
import { touchUserLastSeen } from "./user-repo.js";

/**
 * `GET /api/auth/me` — return the current user's identity, or
 * 401 if no valid session.
 *
 * Response shape on success:
 * ```json
 * {
 *   "ok": true,
 *   "user": {
 *     "provider": "github",
 *     "providerUserId": "12345",
 *     "login": "octocat",
 *     "name": "The Octocat",
 *     "avatarUrl": "https://github.com/octocat.png",
 *     "userId": "<uuid>",
 *     "workspaceId": "<uuid>"
 *   }
 * }
 * ```
 *
 * The session's `createdAt` / `lastSeenAt` are intentionally
 * not exposed on this endpoint — the client doesn't need them.
 * Phase 3 added the side effect of touching `users.last_seen_at`
 * each time `/me` resolves a valid session, so the database
 * timestamp reflects real activity.
 */
export async function handleAuthMe(c: Context<{ Bindings: Env }>): Promise<Response> {
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

  // Touch the DB-side `last_seen_at`. Best-effort: the helper
  // swallows errors so a transient D1 hiccup doesn't 5xx the
  // /me call for an already-authenticated user. Skip the touch
  // for pre-Phase-3 sessions that don't carry `userId`.
  if (session.userId) {
    await touchUserLastSeen(c.env.DB, session.userId);
  }

  return c.json({
    ok: true,
    user: {
      provider: session.provider,
      providerUserId: session.providerUserId,
      login: session.login,
      name: session.name,
      avatarUrl: session.avatarUrl,
      userId: session.userId,
      workspaceId: session.workspaceId,
    },
  });
}

/**
 * `POST /api/auth/logout` — invalidate the current session.
 *
 * - Deletes the session record from KV (idempotent: missing
 *   session is fine).
 * - Sets a cleared session cookie so the browser drops it.
 * - Returns 204 No Content on success.
 *
 * POST (not GET) so a `<a href>` accidental click can't log the
 * user out. Clients fetch this with credentials and SameSite=Lax
 * allows the cookie to ride along.
 */
export async function handleAuthLogout(c: Context<{ Bindings: Env }>): Promise<Response> {
  const token = readSessionCookie(c.req.header("Cookie") ?? null);
  if (token) {
    await deleteSession(c.env.SESSIONS, token);
  }
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": buildClearedSessionCookie() },
  });
}
