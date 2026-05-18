// Session + cookie + random-token helpers. Used by the auth flow
// (Phase 2c GitHub OAuth, Phase 3 Google OAuth) and any future
// endpoint that needs to identify the current user.
//
// Design notes:
// - **KV-backed sessions**: the session cookie carries an opaque
//   bearer token (URL-safe base64). The token is the KV key; the
//   value is the session record. Revocation = `KV.delete()`.
// - **httpOnly + Secure + SameSite=Lax**: standard hardening.
//   Lax (not Strict) is required because OAuth callbacks are
//   cross-site redirects that must include the cookie.
// - **30-day TTL** matches GitHub's default OAuth token lifetime
//   for an unused session. Touch-on-use renewal lands in Phase 3.

const SESSION_COOKIE_NAME = "annot_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes

/**
 * Identity attached to a session. For Phase 2c (GitHub OAuth)
 * only `provider: "github"` is emitted; Phase 3 adds
 * `provider: "google"`.
 *
 * Note: at Phase 2c there is no `users` table yet, so the session
 * is the ONLY persistent identity record. Phase 3 promotes this
 * into a row in D1 and adds `user_id` to the session record.
 */
export interface SessionRecord {
  /** Provider — "github" | "google" (Phase 3) */
  provider: "github" | "google";
  /** Provider's user id (numeric for GitHub, string for Google) */
  providerUserId: string;
  /** Login / handle */
  login: string;
  /** Display name (may be empty if the provider doesn't expose one) */
  name: string;
  /** Avatar URL (may be empty) */
  avatarUrl: string;
  /** ISO timestamp when this session was first created */
  createdAt: string;
  /** ISO timestamp of the most recent activity (touched on /me) */
  lastSeenAt: string;
}

/**
 * Generate a cryptographically random URL-safe token. 32 bytes
 * (256 bits) of entropy — wide enough that brute-forcing a valid
 * session token is computationally infeasible.
 */
export function randomToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

/** Convert raw bytes to a URL-safe base64 string (no padding). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Inverse of `base64UrlEncode`. Used by tests and for tokens
 *  read back from the cookie. */
export function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const decoded = atob(padded);
  const buf = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) buf[i] = decoded.charCodeAt(i);
  return buf;
}

/**
 * Build the `Set-Cookie` header value for a new session.
 * httpOnly + Secure + SameSite=Lax + Path=/. Max-Age matches the
 * KV TTL so the browser drops the cookie at the same time KV
 * drops the value.
 */
export function buildSessionCookie(token: string): string {
  return (
    `${SESSION_COOKIE_NAME}=${token}; ` +
    "Path=/; " +
    `Max-Age=${SESSION_TTL_SECONDS}; ` +
    "HttpOnly; Secure; SameSite=Lax"
  );
}

/**
 * Build a `Set-Cookie` header value that invalidates the session
 * cookie (Max-Age=0 + empty value). Used by `/api/auth/logout`.
 */
export function buildClearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; ` + "Path=/; Max-Age=0; " + "HttpOnly; Secure; SameSite=Lax";
}

/**
 * Extract the session token from the `Cookie` request header.
 * Returns null if the cookie is absent or malformed.
 *
 * Hono provides a cookie middleware, but for a single read
 * site this self-contained parse keeps the dep surface smaller.
 */
export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq);
    if (name === SESSION_COOKIE_NAME) {
      const value = part.slice(eq + 1);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * Persist a session in KV. Returns the cookie-ready token; the
 * caller is expected to set `Set-Cookie` on the response with
 * `buildSessionCookie(token)`.
 */
export async function createSession(kv: KVNamespace, record: SessionRecord): Promise<string> {
  const token = randomToken();
  await kv.put(`session:${token}`, JSON.stringify(record), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

/**
 * Look up a session by token. Returns null when the token is
 * missing, expired, or has malformed payload.
 */
export async function loadSession(kv: KVNamespace, token: string): Promise<SessionRecord | null> {
  const raw = await kv.get(`session:${token}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionRecord;
    if (typeof parsed.provider !== "string" || typeof parsed.providerUserId !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Delete a session from KV. Idempotent — calling delete on a
 * missing key is a no-op.
 */
export async function deleteSession(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(`session:${token}`);
}

/**
 * Store an OAuth CSRF state token in KV with a short TTL.
 * Returns the token to embed in the GitHub authorize URL.
 */
export async function createOAuthState(
  kv: KVNamespace,
  provider: "github" | "google",
): Promise<string> {
  const token = randomToken();
  await kv.put(
    `oauth-state:${provider}:${token}`,
    JSON.stringify({ createdAt: new Date().toISOString() }),
    { expirationTtl: OAUTH_STATE_TTL_SECONDS },
  );
  return token;
}

/**
 * Verify and consume an OAuth CSRF state token. Returns true if
 * the token was present (and was deleted as a side effect);
 * false if absent or expired.
 *
 * Single-use: the state is deleted on first consumption so a
 * replayed callback fails.
 */
export async function consumeOAuthState(
  kv: KVNamespace,
  provider: "github" | "google",
  token: string,
): Promise<boolean> {
  const key = `oauth-state:${provider}:${token}`;
  const value = await kv.get(key);
  if (value === null) return false;
  await kv.delete(key);
  return true;
}
