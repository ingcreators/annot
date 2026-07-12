// GitHub App user-to-server token flow — github-app-user-tokens
// plan Phase 1.
//
// Lets a signed-in annot.work user authorize the GitHub App once
// (popup) and then source GitHubStore's bearer token from
// `GET /api/github/token` instead of pasting a PAT:
//
//   1. PWA opens `GET /api/github/app/connect` in a popup. The
//      Worker mints a CSRF state bound to the session's userId and
//      302s to GitHub's authorize page.
//   2. GitHub redirects back to `GET /api/github/app/callback`.
//      The Worker consumes the state, exchanges the code for a
//      user-to-server access + refresh token pair (8 h / 6 mo when
//      "expire user authorization tokens" is enabled on the App),
//      captures the GitHub login, upserts `github_user_tokens`,
//      and 302s to the terminal success page.
//   3. `GET /api/github/token` returns the access token, silently
//      running the refresh-token grant first when the token is
//      near expiry. The refresh token NEVER leaves the Worker.
//
// Why user-to-server tokens: scope is the intersection of the App
// installation's repo set and the user's own permissions —
// equivalent to a fine-grained PAT, strictly narrower than an
// OAuth App's `repo` scope — and a leaked browser-side token is
// worth 8 hours, not indefinitely. See
// `docs/plans/github-app-user-tokens.md`.

import type { Context } from "hono";
import { requireAuth } from "./auth-middleware.js";
import { signGitHubAppJwt } from "./embed/github-app-token.js";
import type { Env } from "./index.js";
import { consumeOAuthStatePayload, createOAuthState } from "./session.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_APP_URL = "https://api.github.com/app";

/** Refresh the access token when less than this remains. Five
 *  minutes comfortably covers clock skew + the PWA's in-flight
 *  requests racing a rollover. */
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** KV cache for `GET /api/github/app/meta` (App slug / name).
 *  The slug changes only when the operator renames the App. */
const APP_META_CACHE_KEY = "gh-app-meta";
const APP_META_CACHE_SECONDS = 24 * 60 * 60;

// ─── D1 repo ─────────────────────────────────────────────────────

/** Mirrors the `github_user_tokens` table (0006). */
export interface GitHubUserTokenRow {
  user_id: string;
  github_login: string | null;
  access_token: string;
  /** Unix ms; null = non-expiring (App has token expiry disabled). */
  access_token_expires_at: number | null;
  refresh_token: string | null;
  refresh_token_expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export async function getGitHubUserToken(
  db: D1Database,
  userId: string,
): Promise<GitHubUserTokenRow | null> {
  const row = await db
    .prepare("SELECT * FROM github_user_tokens WHERE user_id = ?")
    .bind(userId)
    .first<GitHubUserTokenRow>();
  return row ?? null;
}

export async function upsertGitHubUserToken(
  db: D1Database,
  row: Omit<GitHubUserTokenRow, "created_at" | "updated_at">,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO github_user_tokens (
         user_id, github_login, access_token, access_token_expires_at,
         refresh_token, refresh_token_expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         github_login             = excluded.github_login,
         access_token             = excluded.access_token,
         access_token_expires_at  = excluded.access_token_expires_at,
         refresh_token            = excluded.refresh_token,
         refresh_token_expires_at = excluded.refresh_token_expires_at,
         updated_at               = excluded.updated_at`,
    )
    .bind(
      row.user_id,
      row.github_login,
      row.access_token,
      row.access_token_expires_at,
      row.refresh_token,
      row.refresh_token_expires_at,
      now,
      now,
    )
    .run();
}

export async function deleteGitHubUserToken(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM github_user_tokens WHERE user_id = ?").bind(userId).run();
}

// ─── OAuth token grants ──────────────────────────────────────────

/** Normalised result of a code-exchange or refresh grant. */
export interface UserTokenGrant {
  accessToken: string;
  /** Unix ms; null when the App issues non-expiring tokens. */
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
}

/** Raw response of GitHub's OAuth token endpoint. NOTE: the
 *  endpoint reports grant failures as `error` fields in a 200
 *  body, not as HTTP error statuses. */
interface RawTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Error thrown when GitHub rejects a token grant (bad code, dead
 *  refresh token, …) as opposed to a transport failure. Callers
 *  use the distinction to decide "re-authorize" vs "retry later". */
export class GrantRejectedError extends Error {}

async function requestTokenGrant(env: Env, body: Record<string, string>): Promise<UserTokenGrant> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "annot-api",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      ...body,
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub token endpoint returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as RawTokenResponse;
  if (json.error || !json.access_token) {
    throw new GrantRejectedError(
      json.error_description ?? json.error ?? "Token response missing access_token",
    );
  }
  const now = Date.now();
  return {
    accessToken: json.access_token,
    accessTokenExpiresAt: typeof json.expires_in === "number" ? now + json.expires_in * 1000 : null,
    refreshToken: json.refresh_token ?? null,
    refreshTokenExpiresAt:
      typeof json.refresh_token_expires_in === "number"
        ? now + json.refresh_token_expires_in * 1000
        : null,
  };
}

/** Exchange the callback `code` for the initial token pair. */
export function exchangeCodeForUserToken(env: Env, code: string): Promise<UserTokenGrant> {
  return requestTokenGrant(env, { code });
}

/** Rotate an expiring access token via the refresh-token grant.
 *  GitHub also rotates the refresh token itself on every use. */
export function refreshUserToken(env: Env, refreshToken: string): Promise<UserTokenGrant> {
  return requestTokenGrant(env, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

// ─── Handlers ────────────────────────────────────────────────────

/**
 * `GET /api/github/app/connect` — start the user-authorization
 * flow. Session-gated: the state is bound to the session's userId
 * so the callback can reject cross-session injections.
 */
export async function handleGithubAppConnect(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  if (!c.env.GITHUB_APP_CLIENT_ID) {
    return c.json(
      {
        ok: false,
        error: "app_not_configured",
        message: "GITHUB_APP_CLIENT_ID is not set as a Worker secret.",
      },
      500,
    );
  }

  const state = await createOAuthState(c.env.SESSIONS, "github-app", auth.userId);
  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", c.env.GITHUB_APP_CLIENT_ID);
  authorizeUrl.searchParams.set("state", state);
  // No `scope` — GitHub Apps derive permissions from the App's
  // configuration, not the authorize request. No `redirect_uri` —
  // GitHub uses the callback URL registered on the App.
  return c.redirect(authorizeUrl.toString(), 302);
}

/**
 * `GET /api/github/app/callback?code=&state=` — finish the flow.
 *
 * Fails closed at each step (same ladder as the sign-in flow's
 * `handleGithubCallback`):
 *   - No session                          → 401 (requireAuth)
 *   - Missing `code` / `state`            → 400 invalid_request
 *   - State unknown / expired / replayed  → 401 invalid_state
 *   - State minted under another session  → 401 invalid_state
 *   - Missing client secret               → 500 app_not_configured
 *   - Grant / user fetch fails            → 502 upstream_error
 *
 * On success: upserts `github_user_tokens` for the session's user
 * and 302s to `/api/github/app/success`.
 */
export async function handleGithubAppCallback(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

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

  const consumed = await consumeOAuthStatePayload(c.env.SESSIONS, "github-app", state);
  if (!consumed.ok || consumed.payload !== auth.userId) {
    return c.json(
      {
        ok: false,
        error: "invalid_state",
        message: "OAuth state is unknown, expired, already consumed, or bound to another session.",
      },
      401,
    );
  }

  if (!c.env.GITHUB_APP_CLIENT_ID || !c.env.GITHUB_APP_CLIENT_SECRET) {
    return c.json(
      {
        ok: false,
        error: "app_not_configured",
        message:
          "GITHUB_APP_CLIENT_ID and / or GITHUB_APP_CLIENT_SECRET are not set as Worker secrets.",
      },
      500,
    );
  }

  let grant: UserTokenGrant;
  try {
    grant = await exchangeCodeForUserToken(c.env, code);
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: "upstream_error",
        message: err instanceof Error ? err.message : "GitHub code exchange failed",
      },
      502,
    );
  }

  // Capture the GitHub login for the PWA's "Connected as X" label.
  // Also serves as a validity probe on the fresh token.
  let githubLogin: string | null = null;
  try {
    const userRes = await fetch(GITHUB_USER_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${grant.accessToken}`,
        "User-Agent": "annot-api",
      },
    });
    if (userRes.ok) {
      const user = (await userRes.json()) as { login?: string };
      githubLogin = user.login ?? null;
    }
  } catch {
    // Best-effort — a missing login doesn't invalidate the grant.
  }

  await upsertGitHubUserToken(c.env.DB, {
    user_id: auth.userId,
    github_login: githubLogin,
    access_token: grant.accessToken,
    access_token_expires_at: grant.accessTokenExpiresAt,
    refresh_token: grant.refreshToken,
    refresh_token_expires_at: grant.refreshTokenExpiresAt,
  });

  return c.redirect("/api/github/app/success", 302);
}

/**
 * `GET /api/github/token` — hand the PWA a currently-valid access
 * token. Runs the refresh grant first when the token is inside the
 * expiry margin. Error codes the PWA branches on:
 *   - 404 `not_connected`   — user never authorized (or disconnected)
 *   - 401 `reauth_required` — refresh token dead; row deleted; the
 *                             PWA should re-run the connect popup
 */
export async function handleGithubTokenGet(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const row = await getGitHubUserToken(c.env.DB, auth.userId);
  if (!row) {
    return c.json(
      {
        ok: false,
        error: "not_connected",
        message: "No GitHub App authorization on file for this user.",
      },
      404,
    );
  }

  const now = Date.now();
  const expiring =
    row.access_token_expires_at !== null &&
    row.access_token_expires_at - now < ACCESS_TOKEN_REFRESH_MARGIN_MS;

  if (!expiring) {
    return c.json({
      ok: true,
      token: row.access_token,
      expiresAt: row.access_token_expires_at,
      githubLogin: row.github_login,
    });
  }

  const reauth = async (message: string): Promise<Response> => {
    // Dead refresh path — drop the row so subsequent calls return
    // the cheaper 404 and the PWA's connect flow starts clean.
    await deleteGitHubUserToken(c.env.DB, auth.userId);
    return c.json({ ok: false, error: "reauth_required", message }, 401);
  };

  if (!row.refresh_token) {
    return reauth("Access token expired and no refresh token is on file.");
  }
  if (row.refresh_token_expires_at !== null && row.refresh_token_expires_at <= now) {
    return reauth("Refresh token has expired.");
  }

  let grant: UserTokenGrant;
  try {
    grant = await refreshUserToken(c.env, row.refresh_token);
  } catch (err) {
    if (err instanceof GrantRejectedError) {
      return reauth(`GitHub rejected the refresh grant: ${err.message}`);
    }
    // Transport-level failure — keep the row (the refresh token may
    // still be fine) and let the PWA retry.
    return c.json(
      {
        ok: false,
        error: "upstream_error",
        message: err instanceof Error ? err.message : "GitHub refresh grant failed",
      },
      502,
    );
  }

  await upsertGitHubUserToken(c.env.DB, {
    user_id: auth.userId,
    github_login: row.github_login,
    access_token: grant.accessToken,
    access_token_expires_at: grant.accessTokenExpiresAt,
    // GitHub rotates the refresh token on every grant; fall back to
    // the previous one if (against documented behaviour) none came back.
    refresh_token: grant.refreshToken ?? row.refresh_token,
    refresh_token_expires_at: grant.refreshTokenExpiresAt ?? row.refresh_token_expires_at,
  });

  return c.json({
    ok: true,
    token: grant.accessToken,
    expiresAt: grant.accessTokenExpiresAt,
    githubLogin: row.github_login,
  });
}

/**
 * `DELETE /api/github/token` — disconnect. Deletes the row and
 * best-effort revokes the grant on GitHub's side (so the App
 * disappears from the user's authorized-apps list).
 */
export async function handleGithubTokenDelete(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const row = await getGitHubUserToken(c.env.DB, auth.userId);
  if (row && c.env.GITHUB_APP_CLIENT_ID && c.env.GITHUB_APP_CLIENT_SECRET) {
    try {
      await fetch(
        `https://api.github.com/applications/${encodeURIComponent(c.env.GITHUB_APP_CLIENT_ID)}/grant`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Basic ${btoa(`${c.env.GITHUB_APP_CLIENT_ID}:${c.env.GITHUB_APP_CLIENT_SECRET}`)}`,
            "User-Agent": "annot-api",
          },
          body: JSON.stringify({ access_token: row.access_token }),
        },
      );
    } catch {
      // Best-effort — the local delete below is the source of truth
      // for our side; a failed revoke leaves an inert grant the user
      // can clean up from github.com/settings/apps/authorizations.
    }
  }
  await deleteGitHubUserToken(c.env.DB, auth.userId);
  return c.json({ ok: true });
}

/**
 * `GET /api/github/app/meta` — App slug + display name, used by
 * the PWA to build the "install / configure the App" link
 * (`https://github.com/apps/<slug>/installations/new`). Fetched
 * via App-JWT auth and cached in KV for 24 h.
 */
export async function handleGithubAppMeta(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const cached = await c.env.SESSIONS.get(APP_META_CACHE_KEY);
  if (cached) {
    try {
      const meta = JSON.parse(cached) as { slug: string; appName: string; htmlUrl: string };
      return c.json({ ok: true, ...meta });
    } catch {
      // Fall through to re-fetch on parse error.
    }
  }

  let jwt: string;
  try {
    jwt = await signGitHubAppJwt(c.env);
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: "app_not_configured",
        message: err instanceof Error ? err.message : "GitHub App credentials unavailable",
      },
      500,
    );
  }

  const res = await fetch(GITHUB_APP_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "User-Agent": "annot-api",
    },
  });
  if (!res.ok) {
    return c.json(
      {
        ok: false,
        error: "upstream_error",
        message: `GitHub /app returned HTTP ${res.status}`,
      },
      502,
    );
  }
  const app = (await res.json()) as { slug?: string; name?: string; html_url?: string };
  if (!app.slug) {
    return c.json(
      { ok: false, error: "upstream_error", message: "GitHub /app response missing slug" },
      502,
    );
  }
  const meta = {
    slug: app.slug,
    appName: app.name ?? app.slug,
    htmlUrl: app.html_url ?? `https://github.com/apps/${app.slug}`,
  };
  await c.env.SESSIONS.put(APP_META_CACHE_KEY, JSON.stringify(meta), {
    expirationTtl: APP_META_CACHE_SECONDS,
  });
  return c.json({ ok: true, ...meta });
}

// ─── Success terminal page ───────────────────────────────────────

/** Clone of `/api/auth/success` with a distinct postMessage type
 *  so the PWA can tell "cloud session created" and "GitHub App
 *  connected" popups apart. Same CSP / no-cache posture. */
const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GitHub connected</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }
    main {
      min-height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 32px;
      box-sizing: border-box;
      text-align: center;
    }
    h1 { margin: 0; font-size: 20px; font-weight: 600; }
    p { margin: 0; font-size: 14px; color: #94a3b8; max-width: 36ch; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .ok {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #16a34a;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      line-height: 1;
    }
  </style>
</head>
<body>
  <main>
    <div class="ok" aria-hidden="true">✓</div>
    <h1>GitHub connected</h1>
    <p id="msg">You can close this window. <a href="/app/">Return to Annot</a></p>
  </main>
  <script>
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: "annot-github-app-connected" },
          window.location.origin,
        );
      }
    } catch (e) {
      // Cross-origin opener / blocked postMessage — the PWA's poll
      // fallback picks the connection up via /api/github/token.
    }
    try {
      window.close();
    } catch {
      /* ignore */
    }
  </script>
</body>
</html>`;

export function handleGithubAppSuccess(_c: Context<{ Bindings: Env }>): Response {
  return new Response(SUCCESS_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
