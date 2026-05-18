// GitHub OAuth flow handlers — Phase 2c.
//
// Flow:
//   1. Browser hits `/api/auth/github`.
//   2. Worker creates a CSRF state, stores it in KV, redirects
//      to `https://github.com/login/oauth/authorize?...`.
//   3. User approves, GitHub redirects back to
//      `/api/auth/github/callback?code=...&state=...`.
//   4. Worker verifies the state, exchanges `code` for an access
//      token, fetches `/user` to identify the GitHub account,
//      creates a session in KV, sets the session cookie, and
//      redirects to the web app.
//
// Scope: `read:user user:email` — identity only. Saving to a
// user's GitHub repo continues to use the PAT path or (future)
// GitHub App; this OAuth flow is just for sign-in.
//
// References:
//   - https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
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

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

/** Where to bounce the user after a successful sign-in. */
const POST_LOGIN_REDIRECT = "/";

/**
 * `GET /api/auth/github` — start the OAuth flow. Builds the
 * GitHub authorize URL with a freshly-minted CSRF state and
 * 302-redirects the browser to GitHub.
 *
 * Caller must have `GITHUB_OAUTH_CLIENT_ID` set as a Worker
 * secret. If absent, returns 500 with a configuration error
 * (so the operator sees a clear failure rather than a confusing
 * GitHub-side 401).
 */
export async function handleGithubStart(c: Context<{ Bindings: Env }>): Promise<Response> {
  const clientId = c.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return c.json(
      {
        ok: false,
        error: "oauth_not_configured",
        message: "GITHUB_OAUTH_CLIENT_ID is not set as a Worker secret.",
      },
      500,
    );
  }

  const state = await createOAuthState(c.env.SESSIONS, "github");
  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("scope", "read:user user:email");
  authorizeUrl.searchParams.set("state", state);
  // No `redirect_uri`: GitHub uses the URL registered on the
  // OAuth App. Multiple callback URLs (prod + localhost) are
  // registered on the app itself so dev / prod share the same
  // start endpoint.

  return c.redirect(authorizeUrl.toString(), 302);
}

/**
 * `GET /api/auth/github/callback?code=...&state=...` — finish
 * the OAuth flow.
 *
 * Fails closed at each step:
 *   - Missing `code` / `state`         → 400 invalid_request
 *   - State not in KV (stale / forged) → 401 invalid_state
 *   - Missing client secret            → 500 oauth_not_configured
 *   - Token exchange fails             → 502 upstream_error
 *   - `/user` fetch fails              → 502 upstream_error
 *
 * On success: 302 redirect to `/` with `Set-Cookie` carrying the
 * new session token.
 */
export async function handleGithubCallback(c: Context<{ Bindings: Env }>): Promise<Response> {
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

  const stateOk = await consumeOAuthState(c.env.SESSIONS, "github", state);
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

  const clientId = c.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = c.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.json(
      {
        ok: false,
        error: "oauth_not_configured",
        message:
          "GITHUB_OAUTH_CLIENT_ID and / or GITHUB_OAUTH_CLIENT_SECRET are " +
          "not set as Worker secrets.",
      },
      500,
    );
  }

  // Exchange code → access_token.
  let accessToken: string;
  try {
    const tokenRes = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "annot-api",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    if (!tokenRes.ok) {
      return c.json(
        {
          ok: false,
          error: "upstream_error",
          message: `GitHub token exchange failed (${tokenRes.status})`,
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
            ? `GitHub token exchange threw: ${err.message}`
            : "GitHub token exchange threw an unknown error",
      },
      502,
    );
  }

  // Fetch the authenticated user.
  let user: {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
  };
  try {
    const userRes = await fetch(GITHUB_USER_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "annot-api",
      },
    });
    if (!userRes.ok) {
      return c.json(
        {
          ok: false,
          error: "upstream_error",
          message: `GitHub /user fetch failed (${userRes.status})`,
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
            ? `GitHub /user fetch threw: ${err.message}`
            : "GitHub /user fetch threw an unknown error",
      },
      502,
    );
  }

  // Promote the GitHub identity into a D1-persisted user +
  // personal workspace (first-time login → fresh rows; otherwise
  // re-use). Failure here surfaces as a 500 because the OAuth
  // exchange succeeded but we can't establish the user record —
  // retrying is meaningful, vs the upstream 502s where retry
  // doesn't help.
  let upserted: Awaited<ReturnType<typeof findOrCreateUserFromProvider>>;
  try {
    upserted = await findOrCreateUserFromProvider(c.env.DB, {
      provider: "github",
      providerUserId: String(user.id),
      email: null, // GitHub /user.email may be null; Phase 3 doesn't
      // hit /user/emails yet. Promotion of the verified primary
      // email lands in a follow-up.
      displayName: user.name ?? "",
      avatarUrl: user.avatar_url,
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
    provider: "github",
    providerUserId: String(user.id),
    login: user.login,
    name: user.name ?? "",
    avatarUrl: user.avatar_url,
    createdAt: now,
    lastSeenAt: now,
    userId: upserted.user.id,
    workspaceId: upserted.workspace.id,
  };
  const token = await createSession(c.env.SESSIONS, record);

  // Use the standard Response constructor to attach both
  // `Set-Cookie` and `Location` simultaneously. Hono's `c.redirect`
  // doesn't expose a cookie surface in one call; building the
  // Response directly is the cleanest path.
  return new Response(null, {
    status: 302,
    headers: {
      Location: POST_LOGIN_REDIRECT,
      "Set-Cookie": buildSessionCookie(token),
    },
  });
}
