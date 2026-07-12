// Tests for the GitHub App user-to-server token flow
// (github-app-user-tokens plan Phase 1).
//
// Same conventions as auth-github.test.ts: handlers exercised
// through the Hono app with `app.request(path, init, env)`,
// GitHub's endpoints stubbed via `vi.stubGlobal("fetch", …)`,
// D1 backed by the SQLite mock so the 0006 migration's schema
// and UPSERT semantics are real.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteGitHubUserToken,
  getGitHubUserToken,
  upsertGitHubUserToken,
} from "./github-user-token.js";
import app from "./index.js";
import { createOAuthState, createSession, type SessionRecord } from "./session.js";
import { makeMockD1Sqlite, makeMockEnv, makeMockKv } from "./test-helpers.js";
import { findOrCreateUserFromProvider } from "./user-repo.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const HOUR_MS = 60 * 60 * 1000;

/** Build an env with a real (SQLite) D1, a signed-in session, and
 *  the D1-backed user row the session points at. */
async function makeAuthedEnv() {
  const kv = makeMockKv();
  const db = makeMockD1Sqlite();
  const env = makeMockEnv({ SESSIONS: kv, DB: db });
  const identity = await findOrCreateUserFromProvider(db, {
    provider: "github",
    providerUserId: "12345",
    email: null,
    displayName: "The Octocat",
    avatarUrl: "",
  });
  const record: SessionRecord = {
    provider: "github",
    providerUserId: "12345",
    login: "octocat",
    name: "The Octocat",
    avatarUrl: "",
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    userId: identity.user.id,
    workspaceId: identity.workspace.id,
  };
  const sessionToken = await createSession(kv, record);
  return {
    env,
    kv,
    db,
    userId: identity.user.id,
    cookie: { Cookie: `annot_session=${sessionToken}` },
  };
}

/** Canned OAuth token-endpoint response (expiring flavour). */
function tokenGrantResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: "ghu_fresh-token",
    expires_in: 8 * 60 * 60,
    refresh_token: "ghr_fresh-refresh",
    refresh_token_expires_in: 180 * 24 * 60 * 60,
    token_type: "bearer",
    ...overrides,
  };
}

describe("GET /api/github/app/connect", () => {
  it("requires a session", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/github/app/connect", {}, env);
    expect(res.status).toBe(401);
  });

  it("redirects to GitHub authorize with a state bound to the user", async () => {
    const { env, kv, userId, cookie } = await makeAuthedEnv();
    const res = await app.request("/api/github/app/connect", { headers: cookie }, env);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("test-app-client-id");
    // GitHub Apps derive permissions from the App config — no scope param.
    expect(location.searchParams.get("scope")).toBeNull();
    // Explicit redirect_uri: with two callback URLs registered on
    // the App (embed setup first), GitHub's no-redirect_uri
    // fallback would pick the wrong one.
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/github/app/callback",
    );
    const state = location.searchParams.get("state")!;
    const stored = await kv.get(`oauth-state:github-app:${state}`);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!).payload).toBe(userId);
  });

  it("500s with app_not_configured when the client id is unset", async () => {
    const { env, cookie } = await makeAuthedEnv();
    env.GITHUB_APP_CLIENT_ID = "";
    const res = await app.request("/api/github/app/connect", { headers: cookie }, env);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe("app_not_configured");
  });
});

describe("GET /api/github/app/callback", () => {
  it("rejects a state bound to a different user", async () => {
    const { env, kv, cookie } = await makeAuthedEnv();
    const state = await createOAuthState(kv, "github-app", "someone-else");
    const res = await app.request(
      `/api/github/app/callback?code=abc&state=${state}`,
      { headers: cookie },
      env,
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_state");
  });

  it("rejects an unknown / replayed state", async () => {
    const { env, cookie } = await makeAuthedEnv();
    const res = await app.request(
      "/api/github/app/callback?code=abc&state=forged",
      { headers: cookie },
      env,
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_state");
  });

  it("exchanges the code, stores the token row, and redirects to success", async () => {
    const { env, kv, db, userId, cookie } = await makeAuthedEnv();
    const state = await createOAuthState(kv, "github-app", userId);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.startsWith("https://github.com/login/oauth/access_token")) {
          return new Response(JSON.stringify(tokenGrantResponse()), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (u.startsWith("https://api.github.com/user")) {
          return new Response(JSON.stringify({ login: "octocat" }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch: ${u}`);
      }),
    );

    const res = await app.request(
      `/api/github/app/callback?code=good-code&state=${state}`,
      { headers: cookie },
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/github/app/success");

    const row = await getGitHubUserToken(db, userId);
    expect(row).not.toBeNull();
    expect(row!.access_token).toBe("ghu_fresh-token");
    expect(row!.refresh_token).toBe("ghr_fresh-refresh");
    expect(row!.github_login).toBe("octocat");
    expect(row!.access_token_expires_at).toBeGreaterThan(Date.now());
  });

  it("502s when GitHub reports a grant error in a 200 body", async () => {
    const { env, kv, userId, cookie } = await makeAuthedEnv();
    const state = await createOAuthState(kv, "github-app", userId);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "bad_verification_code", error_description: "expired" }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const res = await app.request(
      `/api/github/app/callback?code=stale&state=${state}`,
      { headers: cookie },
      env,
    );
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("upstream_error");
  });
});

describe("GET /api/github/token", () => {
  it("404s not_connected when the user never authorized", async () => {
    const { env, cookie } = await makeAuthedEnv();
    const res = await app.request("/api/github/token", { headers: cookie }, env);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_connected");
  });

  it("returns the stored token when it is not near expiry", async () => {
    const { env, db, userId, cookie } = await makeAuthedEnv();
    const expiresAt = Date.now() + 4 * HOUR_MS;
    await upsertGitHubUserToken(db, {
      user_id: userId,
      github_login: "octocat",
      access_token: "ghu_live",
      access_token_expires_at: expiresAt,
      refresh_token: "ghr_live",
      refresh_token_expires_at: Date.now() + 100 * 24 * HOUR_MS,
    });
    // No fetch stub — a network call would throw and fail the test.
    const res = await app.request("/api/github/token", { headers: cookie }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number; githubLogin: string };
    expect(body.token).toBe("ghu_live");
    expect(body.expiresAt).toBe(expiresAt);
    expect(body.githubLogin).toBe("octocat");
  });

  it("returns a non-expiring token without refreshing", async () => {
    const { env, db, userId, cookie } = await makeAuthedEnv();
    await upsertGitHubUserToken(db, {
      user_id: userId,
      github_login: null,
      access_token: "ghu_forever",
      access_token_expires_at: null,
      refresh_token: null,
      refresh_token_expires_at: null,
    });
    const res = await app.request("/api/github/token", { headers: cookie }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number | null };
    expect(body.token).toBe("ghu_forever");
    expect(body.expiresAt).toBeNull();
  });

  it("refreshes an expiring token and persists the rotated pair", async () => {
    const { env, db, userId, cookie } = await makeAuthedEnv();
    await upsertGitHubUserToken(db, {
      user_id: userId,
      github_login: "octocat",
      access_token: "ghu_stale",
      access_token_expires_at: Date.now() + 60 * 1000, // inside the 5 min margin
      refresh_token: "ghr_old",
      refresh_token_expires_at: Date.now() + 100 * 24 * HOUR_MS,
    });
    const fetchStub = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      expect(body.grant_type).toBe("refresh_token");
      expect(body.refresh_token).toBe("ghr_old");
      return new Response(
        JSON.stringify(
          tokenGrantResponse({ access_token: "ghu_rotated", refresh_token: "ghr_rotated" }),
        ),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchStub);

    const res = await app.request("/api/github/token", { headers: cookie }, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { token: string }).token).toBe("ghu_rotated");

    const row = await getGitHubUserToken(db, userId);
    expect(row!.access_token).toBe("ghu_rotated");
    expect(row!.refresh_token).toBe("ghr_rotated");
  });

  it("401s reauth_required and deletes the row when the refresh grant is rejected", async () => {
    const { env, db, userId, cookie } = await makeAuthedEnv();
    await upsertGitHubUserToken(db, {
      user_id: userId,
      github_login: null,
      access_token: "ghu_stale",
      access_token_expires_at: Date.now() - 1000,
      refresh_token: "ghr_dead",
      refresh_token_expires_at: Date.now() + 100 * 24 * HOUR_MS,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "bad_refresh_token" }), {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const res = await app.request("/api/github/token", { headers: cookie }, env);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("reauth_required");
    expect(await getGitHubUserToken(db, userId)).toBeNull();
  });

  it("401s reauth_required when the token expired and no refresh token exists", async () => {
    const { env, db, userId, cookie } = await makeAuthedEnv();
    await upsertGitHubUserToken(db, {
      user_id: userId,
      github_login: null,
      access_token: "ghu_stale",
      access_token_expires_at: Date.now() - 1000,
      refresh_token: null,
      refresh_token_expires_at: null,
    });
    const res = await app.request("/api/github/token", { headers: cookie }, env);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("reauth_required");
  });

  it("502s and keeps the row on a transport-level refresh failure", async () => {
    const { env, db, userId, cookie } = await makeAuthedEnv();
    await upsertGitHubUserToken(db, {
      user_id: userId,
      github_login: null,
      access_token: "ghu_stale",
      access_token_expires_at: Date.now() + 60 * 1000,
      refresh_token: "ghr_maybe-fine",
      refresh_token_expires_at: Date.now() + 100 * 24 * HOUR_MS,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad gateway", { status: 502 })),
    );
    const res = await app.request("/api/github/token", { headers: cookie }, env);
    expect(res.status).toBe(502);
    expect(await getGitHubUserToken(db, userId)).not.toBeNull();
  });
});

describe("DELETE /api/github/token", () => {
  it("deletes the row and attempts the grant revoke", async () => {
    const { env, db, userId, cookie } = await makeAuthedEnv();
    await upsertGitHubUserToken(db, {
      user_id: userId,
      github_login: "octocat",
      access_token: "ghu_live",
      access_token_expires_at: Date.now() + 4 * HOUR_MS,
      refresh_token: "ghr_live",
      refresh_token_expires_at: Date.now() + 100 * 24 * HOUR_MS,
    });
    const fetchStub = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchStub);

    const res = await app.request("/api/github/token", { method: "DELETE", headers: cookie }, env);
    expect(res.status).toBe(200);
    expect(await getGitHubUserToken(db, userId)).toBeNull();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [revokeUrl, revokeInit] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
    expect(String(revokeUrl)).toBe("https://api.github.com/applications/test-app-client-id/grant");
    expect(revokeInit.method).toBe("DELETE");
  });

  it("still succeeds when the revoke call fails", async () => {
    const { env, db, userId, cookie } = await makeAuthedEnv();
    await upsertGitHubUserToken(db, {
      user_id: userId,
      github_login: null,
      access_token: "ghu_live",
      access_token_expires_at: null,
      refresh_token: null,
      refresh_token_expires_at: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const res = await app.request("/api/github/token", { method: "DELETE", headers: cookie }, env);
    expect(res.status).toBe(200);
    expect(await getGitHubUserToken(db, userId)).toBeNull();
  });

  it("is idempotent when nothing is stored", async () => {
    const { env, cookie } = await makeAuthedEnv();
    const res = await app.request("/api/github/token", { method: "DELETE", headers: cookie }, env);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/github/app/meta", () => {
  it("serves from the KV cache without touching GitHub", async () => {
    const { env, kv, cookie } = await makeAuthedEnv();
    await kv.put(
      "gh-app-meta",
      JSON.stringify({
        slug: "annot-cloud-editor",
        appName: "Annot Cloud Editor",
        htmlUrl: "https://github.com/apps/annot-cloud-editor",
      }),
    );
    const res = await app.request("/api/github/app/meta", { headers: cookie }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; slug: string };
    expect(body.ok).toBe(true);
    expect(body.slug).toBe("annot-cloud-editor");
  });

  it("500s app_not_configured when the App key is unusable", async () => {
    // The default test PEM is not a valid PKCS#8 key, so JWT
    // signing fails — exactly the misconfiguration this error
    // code exists for.
    const { env, cookie } = await makeAuthedEnv();
    const res = await app.request("/api/github/app/meta", { headers: cookie }, env);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe("app_not_configured");
  });
});

describe("GET /api/github/app/success", () => {
  it("serves the terminal page with the App-specific postMessage type", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/github/app/success", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("annot-github-app-connected");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });
});

describe("github_user_tokens repo", () => {
  it("upsert overwrites the existing row for the same user", async () => {
    const db = makeMockD1Sqlite();
    await upsertGitHubUserToken(db, {
      user_id: "u1",
      github_login: "a",
      access_token: "t1",
      access_token_expires_at: 1,
      refresh_token: "r1",
      refresh_token_expires_at: 2,
    });
    await upsertGitHubUserToken(db, {
      user_id: "u1",
      github_login: "b",
      access_token: "t2",
      access_token_expires_at: 3,
      refresh_token: "r2",
      refresh_token_expires_at: 4,
    });
    const row = await getGitHubUserToken(db, "u1");
    expect(row!.access_token).toBe("t2");
    expect(row!.github_login).toBe("b");
    await deleteGitHubUserToken(db, "u1");
    expect(await getGitHubUserToken(db, "u1")).toBeNull();
  });
});
