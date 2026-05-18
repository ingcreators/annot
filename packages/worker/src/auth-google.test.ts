import { afterEach, describe, expect, it, vi } from "vitest";
import app from "./index.js";
import { createOAuthState } from "./session.js";
import { makeMockD1Sqlite, makeMockEnv, makeMockKv } from "./test-helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/auth/google (start)", () => {
  it("redirects to Google authorize URL with state in KV", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/google", {}, env);
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const url = new URL(location ?? "");
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("test-google-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("access_type")).toBe("online");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    // Google REQUIRES redirect_uri — derived from c.req.url.
    const redirectUri = url.searchParams.get("redirect_uri");
    expect(redirectUri).toBeTruthy();
    expect(redirectUri).toContain("/api/auth/google/callback");
  });

  it("returns 500 oauth_not_configured when client_id missing", async () => {
    const env = makeMockEnv({ GOOGLE_OAUTH_CLIENT_ID: "" });
    const res = await app.request("/api/auth/google", {}, env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("oauth_not_configured");
  });

  it("stores the state in KV under the google-scoped key (not github)", async () => {
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const res = await app.request("/api/auth/google", {}, env);
    const url = new URL(res.headers.get("location") ?? "");
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(await kv.get(`oauth-state:google:${state}`)).toBeTruthy();
    expect(await kv.get(`oauth-state:github:${state}`)).toBeNull();
  });
});

describe("GET /api/auth/google/callback (finish)", () => {
  function stubGoogleSuccess(opts?: {
    accessToken?: string;
    user?: {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
  }) {
    const accessToken = opts?.accessToken ?? "ya29.test-access-token";
    const user = opts?.user ?? {
      sub: "108234567890123456789",
      email: "user@example.com",
      email_verified: true,
      name: "Example User",
      picture: "https://lh3.googleusercontent.com/a/example",
    };
    const stub = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        // Verify the request was form-encoded with grant_type +
        // redirect_uri (Google specifics that differ from GitHub).
        const body = String(init?.body ?? "");
        if (!body.includes("grant_type=authorization_code")) {
          return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 });
        }
        if (!body.includes("redirect_uri=")) {
          return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 });
        }
        return new Response(JSON.stringify({ access_token: accessToken }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://www.googleapis.com/oauth2/v3/userinfo") {
        const auth = (init?.headers as Record<string, string>)?.Authorization;
        if (auth !== `Bearer ${accessToken}`) {
          return new Response("unauthorized", { status: 401 });
        }
        return new Response(JSON.stringify(user), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", stub);
    return { stub, accessToken, user };
  }

  it("happy path: form-encoded token POST, /userinfo, D1 upsert, session cookie", async () => {
    stubGoogleSuccess();
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    const env = makeMockEnv({ SESSIONS: kv, DB: db });
    const state = await createOAuthState(kv, "google");

    const res = await app.request(
      `/api/auth/google/callback?code=test-code&state=${state}`,
      {},
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toBeTruthy();
    expect(cookie).toContain("annot_session=");
    expect(cookie).toContain("HttpOnly");

    // State consumed (single-use).
    expect(await kv.get(`oauth-state:google:${state}`)).toBeNull();

    // D1 user row was inserted.
    const userRow = await db
      .prepare("SELECT * FROM users WHERE google_id = ?")
      .bind("108234567890123456789")
      .first<{
        id: string;
        google_id: string;
        github_id: string | null;
        email: string | null;
        display_name: string;
        avatar_url: string;
      }>();
    expect(userRow).not.toBeNull();
    expect(userRow?.github_id).toBeNull();
    expect(userRow?.email).toBe("user@example.com");
    expect(userRow?.display_name).toBe("Example User");

    // Session carries userId / workspaceId.
    const token = /annot_session=([^;]+)/.exec(cookie ?? "")?.[1] ?? "";
    const session = JSON.parse((await kv.get(`session:${token}`)) ?? "{}");
    expect(session.provider).toBe("google");
    expect(session.userId).toBe(userRow?.id);
    expect(typeof session.workspaceId).toBe("string");
  });

  it("400 when code is missing", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/google/callback?state=abc", {}, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("400 when state is missing", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/google/callback?code=abc", {}, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("401 when state is unknown (CSRF or expired)", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/google/callback?code=abc&state=unknown", {}, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_state");
  });

  it("501 oauth_not_configured when client secret missing", async () => {
    const kv = makeMockKv();
    const env = makeMockEnv({
      SESSIONS: kv,
      GOOGLE_OAUTH_CLIENT_SECRET: "",
    });
    const state = await createOAuthState(kv, "google");
    const res = await app.request(`/api/auth/google/callback?code=abc&state=${state}`, {}, env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("oauth_not_configured");
  });

  it("502 upstream_error when Google token endpoint returns non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const state = await createOAuthState(kv, "google");
    const res = await app.request(`/api/auth/google/callback?code=abc&state=${state}`, {}, env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("503");
  });

  it("502 upstream_error when token response carries error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "invalid_grant",
              error_description: "Bad code",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const state = await createOAuthState(kv, "google");
    const res = await app.request(`/api/auth/google/callback?code=abc&state=${state}`, {}, env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("Bad code");
  });

  it("502 upstream_error when /userinfo response missing sub", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://oauth2.googleapis.com/token") {
          return new Response(JSON.stringify({ access_token: "tok" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        // Userinfo response without `sub` — malformed.
        return new Response(JSON.stringify({ email: "x@y.z" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const state = await createOAuthState(kv, "google");
    const res = await app.request(`/api/auth/google/callback?code=abc&state=${state}`, {}, env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("`sub` field");
  });

  it("only trusts email when email_verified is true", async () => {
    stubGoogleSuccess({
      user: {
        sub: "999",
        email: "unverified@example.com",
        email_verified: false,
        name: "Sketchy",
      },
    });
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    const env = makeMockEnv({ SESSIONS: kv, DB: db });
    const state = await createOAuthState(kv, "google");
    await app.request(`/api/auth/google/callback?code=abc&state=${state}`, {}, env);

    const row = await db
      .prepare("SELECT email FROM users WHERE google_id = ?")
      .bind("999")
      .first<{ email: string | null }>();
    expect(row?.email).toBeNull();
  });

  it("returning user re-uses the same userId / workspaceId", async () => {
    stubGoogleSuccess();
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    const env = makeMockEnv({ SESSIONS: kv, DB: db });

    const state1 = await createOAuthState(kv, "google");
    const res1 = await app.request(`/api/auth/google/callback?code=abc&state=${state1}`, {}, env);
    const token1 = /annot_session=([^;]+)/.exec(res1.headers.get("set-cookie") ?? "")?.[1] ?? "";
    const session1 = JSON.parse((await kv.get(`session:${token1}`)) ?? "{}");

    const state2 = await createOAuthState(kv, "google");
    const res2 = await app.request(`/api/auth/google/callback?code=abc&state=${state2}`, {}, env);
    const token2 = /annot_session=([^;]+)/.exec(res2.headers.get("set-cookie") ?? "")?.[1] ?? "";
    const session2 = JSON.parse((await kv.get(`session:${token2}`)) ?? "{}");

    expect(token1).not.toBe(token2);
    expect(session2.userId).toBe(session1.userId);
    expect(session2.workspaceId).toBe(session1.workspaceId);

    const userCount = await db.prepare("SELECT COUNT(*) as n FROM users").first<{ n: number }>();
    expect(userCount?.n).toBe(1);
  });

  it("a GitHub user signing in via Google creates a SEPARATE row (no auto-linking)", async () => {
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    const env = makeMockEnv({ SESSIONS: kv, DB: db });

    // Pre-seed a github user with the same email.
    await db
      .prepare(
        `INSERT INTO users (id, email, github_id, plan, created_at, updated_at, last_seen_at)
         VALUES ('gh-user-id', 'user@example.com', '12345', 'free', 1, 1, 1)`,
      )
      .run();

    stubGoogleSuccess({
      user: {
        sub: "google-sub-different",
        email: "user@example.com",
        email_verified: true,
        name: "Same Person",
      },
    });
    const state = await createOAuthState(kv, "google");
    // The Google sign-in should... fail or create a new row? Our
    // current schema has UNIQUE(email) WHERE NOT NULL, so the
    // INSERT would fail with UNIQUE constraint violation. The
    // handler surfaces that as 500 db_error.
    const res = await app.request(`/api/auth/google/callback?code=abc&state=${state}`, {}, env);

    // Document the current behaviour: email collisions across
    // providers fail. A future "merge accounts" flow can resolve
    // this; the current contract is "each provider is a separate
    // identity" with email collisions being conflicts.
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("db_error");
  });
});
