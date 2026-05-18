import { afterEach, describe, expect, it, vi } from "vitest";
import app from "./index.js";
import { createOAuthState } from "./session.js";
import { makeMockEnv, makeMockKv } from "./test-helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/auth/github (start)", () => {
  it("redirects to GitHub authorize URL with state in KV", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/github", {}, env);
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const url = new URL(location ?? "");
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    expect(url.searchParams.get("state")).toBeTruthy();
    // No redirect_uri — uses the registered URL on the OAuth App.
    expect(url.searchParams.has("redirect_uri")).toBe(false);
  });

  it("returns 500 with oauth_not_configured when client_id missing", async () => {
    const env = makeMockEnv({ GITHUB_OAUTH_CLIENT_ID: "" });
    const res = await app.request("/api/auth/github", {}, env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("oauth_not_configured");
  });

  it("stores the state in KV under the github-scoped key", async () => {
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const res = await app.request("/api/auth/github", {}, env);
    const url = new URL(res.headers.get("location") ?? "");
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    const value = await kv.get(`oauth-state:github:${state}`);
    expect(value).toBeTruthy();
  });
});

describe("GET /api/auth/github/callback (finish)", () => {
  function stubGithubSuccess(opts?: {
    accessToken?: string;
    user?: { id: number; login: string; name: string | null; avatar_url: string };
  }) {
    const accessToken = opts?.accessToken ?? "gho_test-access-token";
    const user = opts?.user ?? {
      id: 12345,
      login: "octocat",
      name: "The Octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/12345",
    };
    const stub = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return new Response(JSON.stringify({ access_token: accessToken }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://api.github.com/user") {
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

  it("happy path: exchanges code, fetches user, sets session cookie, redirects to /", async () => {
    stubGithubSuccess();
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const state = await createOAuthState(kv, "github");

    const res = await app.request(
      `/api/auth/github/callback?code=test-code&state=${state}`,
      {},
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toBeTruthy();
    expect(cookie).toContain("annot_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");

    // The state should have been consumed (single-use).
    expect(await kv.get(`oauth-state:github:${state}`)).toBeNull();
  });

  it("400 when code is missing", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/github/callback?state=abc", {}, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("400 when state is missing", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/github/callback?code=abc", {}, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("401 when state is unknown (CSRF or expired)", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/github/callback?code=abc&state=unknown", {}, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_state");
  });

  it("500 oauth_not_configured when client secret missing", async () => {
    const kv = makeMockKv();
    const env = makeMockEnv({
      SESSIONS: kv,
      GITHUB_OAUTH_CLIENT_SECRET: "",
    });
    const state = await createOAuthState(kv, "github");
    const res = await app.request(`/api/auth/github/callback?code=abc&state=${state}`, {}, env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("oauth_not_configured");
  });

  it("502 upstream_error when GitHub token endpoint returns non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const state = await createOAuthState(kv, "github");
    const res = await app.request(`/api/auth/github/callback?code=abc&state=${state}`, {}, env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("upstream_error");
    expect(body.message).toContain("503");
  });

  it("502 upstream_error when token response is missing access_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "bad_verification_code",
              error_description: "The code passed is incorrect or expired.",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const state = await createOAuthState(kv, "github");
    const res = await app.request(`/api/auth/github/callback?code=abc&state=${state}`, {}, env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("code passed is incorrect or expired");
  });

  it("502 upstream_error when /user fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://github.com/login/oauth/access_token") {
          return new Response(JSON.stringify({ access_token: "tok" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("forbidden", { status: 403 });
      }),
    );
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const state = await createOAuthState(kv, "github");
    const res = await app.request(`/api/auth/github/callback?code=abc&state=${state}`, {}, env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("403");
  });

  it("502 upstream_error when fetch itself throws (network failure)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    );
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const state = await createOAuthState(kv, "github");
    const res = await app.request(`/api/auth/github/callback?code=abc&state=${state}`, {}, env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("network unreachable");
  });

  it("persists the session record with the GitHub user info", async () => {
    const { user } = stubGithubSuccess();
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const state = await createOAuthState(kv, "github");

    const res = await app.request(`/api/auth/github/callback?code=abc&state=${state}`, {}, env);
    const cookie = res.headers.get("set-cookie") ?? "";
    const tokenMatch = /annot_session=([^;]+)/.exec(cookie);
    expect(tokenMatch).not.toBeNull();
    const sessionToken = tokenMatch?.[1] ?? "";
    const stored = await kv.get(`session:${sessionToken}`);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored ?? "{}");
    expect(parsed.provider).toBe("github");
    expect(parsed.providerUserId).toBe(String(user.id));
    expect(parsed.login).toBe(user.login);
    expect(parsed.name).toBe(user.name);
    expect(parsed.avatarUrl).toBe(user.avatar_url);
  });

  it("handles a null `name` from GitHub by storing empty string", async () => {
    stubGithubSuccess({
      user: {
        id: 999,
        login: "anon",
        name: null,
        avatar_url: "https://example/a.png",
      },
    });
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const state = await createOAuthState(kv, "github");
    const res = await app.request(`/api/auth/github/callback?code=abc&state=${state}`, {}, env);
    const cookie = res.headers.get("set-cookie") ?? "";
    const sessionToken = /annot_session=([^;]+)/.exec(cookie)?.[1] ?? "";
    const stored = JSON.parse((await kv.get(`session:${sessionToken}`)) ?? "{}");
    expect(stored.name).toBe("");
  });
});
