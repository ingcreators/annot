// Google OAuth flow handlers — Phase 3c.
//
// Mirrors the GitHub OAuth flow in `auth-github.ts` with the
// Google-specific differences:
// - Authorize URL: `https://accounts.google.com/o/oauth2/v2/auth`
// - Token URL:     `https://oauth2.googleapis.com/token`
// - Userinfo URL:  `https://www.googleapis.com/oauth2/v3/userinfo`
// - Token exchange POSTs form-encoded body (not JSON like GitHub).
// - `redirect_uri` is REQUIRED in both the authorize URL and the
//   token exchange — it's derived from `c.req.url` so the same
//   handler works for `*.workers.dev` AND `api.annot.work` without
//   env-var configuration.
// - Email is always present and verified for Google OAuth (no
//   private-email fallback story).
//
// Identity is persisted through the same
// `findOrCreateUserFromProvider` helper as GitHub, with
// `provider: "google"`. A user that has signed in via both
// providers ends up as TWO distinct rows for now (different
// `github_id` / `google_id` columns, no automatic linking). A
// future "merge accounts" flow can resolve this if there's demand;
// today the simpler "each provider is a separate identity" model
// is the contract.
//
// References:
//   - https://developers.google.com/identity/protocols/oauth2/web-server
//   - Master plan: `docs/plans/annot-cloud-roadmap.md`

import type { Context } from "hono";
import type { Env } from "./index.js";
import {
  buildSessionCookie,
  consumeOAuthState,
  createOAuthState,
  createSession,
  type SessionRecord,
} from "./session.js";
import { findOrCreateUserFromProvider } from "./user-repo.js";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

/** Where to bounce the user after a successful sign-in. Points
 *  at the worker-served terminal page that posts a message to the
 *  PWA opener (if any) and then `window.close()`s the popup.
 *  Same-origin under the `annot.work/api/*` route binding, so the
 *  postMessage origin check on the PWA side passes. */
const POST_LOGIN_REDIRECT = "/api/auth/success";

/**
 * Derive the callback URL from the current request's origin.
 * Works for both production (`https://api.annot.work/...`) and
 * `*.workers.dev` previews without env-var configuration.
 *
 * Google REQUIRES `redirect_uri` on both `/authorize` and `/token`,
 * AND the two must match. Deriving from the same request origin
 * guarantees that property.
 */
function deriveCallbackUrl(c: Context<{ Bindings: Env }>): string {
  const requestUrl = new URL(c.req.url);
  return `${requestUrl.origin}/api/auth/google/callback`;
}

/**
 * `GET /api/auth/google` — start the Google OAuth flow. Builds
 * the authorize URL with a freshly-minted CSRF state and
 * 302-redirects the browser to Google.
 *
 * Returns 500 `oauth_not_configured` when `GOOGLE_OAUTH_CLIENT_ID`
 * is missing so the operator sees a clear failure rather than a
 * confusing Google-side 401.
 */
export async function handleGoogleStart(c: Context<{ Bindings: Env }>): Promise<Response> {
  const clientId = c.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return c.json(
      {
        ok: false,
        error: "oauth_not_configured",
        message: "GOOGLE_OAUTH_CLIENT_ID is not set as a Worker secret.",
      },
      500,
    );
  }

  const state = await createOAuthState(c.env.SESSIONS, "google");
  const authorizeUrl = new URL(GOOGLE_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", deriveCallbackUrl(c));
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "openid email profile");
  authorizeUrl.searchParams.set("state", state);
  // `access_type=online` (default) — we don't need a refresh
  // token; the session cookie carries auth and re-OAuth on expiry
  // is a fresh login.
  authorizeUrl.searchParams.set("access_type", "online");
  // `prompt=select_account` lets users switch Google accounts
  // mid-flow. Not strictly necessary but a nicer UX for users
  // with multiple Google accounts.
  authorizeUrl.searchParams.set("prompt", "select_account");

  return c.redirect(authorizeUrl.toString(), 302);
}

/**
 * `GET /api/auth/google/callback?code=...&state=...` — finish the
 * Google OAuth flow.
 *
 * Same fail-closed semantics as `auth-github.ts`:
 *   - Missing `code` / `state`         → 400 invalid_request
 *   - State not in KV (stale / forged) → 401 invalid_state
 *   - Missing client secret            → 500 oauth_not_configured
 *   - Token exchange fails             → 502 upstream_error
 *   - `/userinfo` fetch fails          → 502 upstream_error
 *   - D1 user upsert fails             → 500 db_error
 *
 * On success: 302 redirect to `/` with `Set-Cookie` carrying the
 * new session token.
 */
export async function handleGoogleCallback(c: Context<{ Bindings: Env }>): Promise<Response> {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return c.json(
      {
        ok: false,
        error: "invalid_request",
        message: "Missing `code` or `state` query parameter.",
      },
      400,
    );
  }

  const stateOk = await consumeOAuthState(c.env.SESSIONS, "google", state);
  if (!stateOk) {
    return c.json(
      {
        ok: false,
        error: "invalid_state",
        message: "OAuth state is unknown, expired, or already consumed.",
      },
      401,
    );
  }

  const clientId = c.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.json(
      {
        ok: false,
        error: "oauth_not_configured",
        message:
          "GOOGLE_OAUTH_CLIENT_ID and / or GOOGLE_OAUTH_CLIENT_SECRET are " +
          "not set as Worker secrets.",
      },
      500,
    );
  }

  const redirectUri = deriveCallbackUrl(c);

  // Exchange code → access_token. Google requires form-encoded
  // POST body (NOT JSON like GitHub) — a subtle but important
  // difference.
  let accessToken: string;
  try {
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenBody.toString(),
    });
    if (!tokenRes.ok) {
      return c.json(
        {
          ok: false,
          error: "upstream_error",
          message: `Google token exchange failed (${tokenRes.status})`,
        },
        502,
      );
    }
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (tokenJson.error || !tokenJson.access_token) {
      return c.json(
        {
          ok: false,
          error: "upstream_error",
          message:
            tokenJson.error_description ?? tokenJson.error ?? "Token response missing access_token",
        },
        502,
      );
    }
    accessToken = tokenJson.access_token;
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: "upstream_error",
        message:
          err instanceof Error
            ? `Google token exchange threw: ${err.message}`
            : "Google token exchange threw an unknown error",
      },
      502,
    );
  }

  // Fetch the authenticated user. Google's /userinfo returns
  // OpenID Connect-style claims: `sub` is the stable provider id,
  // `email` is always present and verified.
  let user: {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  try {
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!userRes.ok) {
      return c.json(
        {
          ok: false,
          error: "upstream_error",
          message: `Google /userinfo fetch failed (${userRes.status})`,
        },
        502,
      );
    }
    user = (await userRes.json()) as typeof user;
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: "upstream_error",
        message:
          err instanceof Error
            ? `Google /userinfo fetch threw: ${err.message}`
            : "Google /userinfo fetch threw an unknown error",
      },
      502,
    );
  }

  if (!user.sub) {
    return c.json(
      {
        ok: false,
        error: "upstream_error",
        message: "Google /userinfo response missing `sub` field",
      },
      502,
    );
  }

  // Promote into a D1-persisted user + personal workspace.
  let upserted: Awaited<ReturnType<typeof findOrCreateUserFromProvider>>;
  try {
    upserted = await findOrCreateUserFromProvider(c.env.DB, {
      provider: "google",
      providerUserId: user.sub,
      // Only trust `email` when Google says it's verified.
      email: user.email && user.email_verified ? user.email : null,
      displayName: user.name ?? "",
      avatarUrl: user.picture ?? "",
    });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: "db_error",
        message:
          err instanceof Error
            ? `User upsert failed: ${err.message}`
            : "User upsert failed with unknown error",
      },
      500,
    );
  }

  const now = new Date().toISOString();
  const record: SessionRecord = {
    provider: "google",
    providerUserId: user.sub,
    // Google doesn't have a separate handle — use the email
    // (or empty string if unavailable) for display purposes.
    login: user.email ?? "",
    name: user.name ?? "",
    avatarUrl: user.picture ?? "",
    createdAt: now,
    lastSeenAt: now,
    userId: upserted.user.id,
    workspaceId: upserted.workspace.id,
  };
  const token = await createSession(c.env.SESSIONS, record);

  return new Response(null, {
    status: 302,
    headers: {
      Location: POST_LOGIN_REDIRECT,
      "Set-Cookie": buildSessionCookie(token),
    },
  });
}
