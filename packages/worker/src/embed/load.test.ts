// Tests for `embed/load.ts` + `embed/github-app-token.ts` —
// Phase 6 follow-up 5y-2.

import { describe, expect, it } from "vitest";
import app from "../index.js";
import { base64UrlEncode, createSession, type SessionRecord } from "../session.js";
import { makeMockD1Sqlite, makeMockEnv, makeMockKv, makeMockR2 } from "../test-helpers.js";
import { upsertGitHubInstallation } from "./github-app.js";
import { isPrivateRepoPlan } from "./load.js";

// ─── Helpers ─────────────────────────────────────────────────

interface SessionFixture {
  cookie: string;
  userId: string;
  workspaceId: string;
}

/** Build a Phase-3-shaped session in KV + return the cookie header
 *  the worker handlers expect. Mirrors the bootstrap path
 *  `auth-github.ts` uses after upserting the user row. */
async function seedSession(opts: {
  kv: KVNamespace;
  userId: string;
  workspaceId: string;
}): Promise<SessionFixture> {
  const now = new Date().toISOString();
  const record: SessionRecord = {
    provider: "github",
    providerUserId: "12345",
    login: "octocat",
    name: "Octocat",
    avatarUrl: "",
    createdAt: now,
    lastSeenAt: now,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
  };
  const token = await createSession(opts.kv, record);
  return { cookie: `annot_session=${token}`, userId: opts.userId, workspaceId: opts.workspaceId };
}

interface FetchResponseInit {
  status?: number;
  body?: unknown;
  text?: string;
}

/** Build a JSON Response. */
function jsonResponse(init: FetchResponseInit): Response {
  if (init.text !== undefined) {
    return new Response(init.text, { status: init.status ?? 200 });
  }
  return new Response(JSON.stringify(init.body ?? {}), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a `fetch` stub that routes GitHub API calls to per-URL
 *  fixtures. Matches longest-pattern-first so a more specific
 *  substring (e.g. `/contents/foo`) wins over a less specific
 *  prefix (e.g. `/repos/foo`). Anything not matched returns 500
 *  so missing-mock paths surface loudly. */
function makeGithubFetch(routes: Record<string, FetchResponseInit>): typeof fetch {
  const sorted = Object.entries(routes).sort(([a], [b]) => b.length - a.length);
  return async (input: Request | URL | string): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    for (const [pattern, init] of sorted) {
      if (url.includes(pattern)) return jsonResponse(init);
    }
    return new Response(`No fixture for ${url}`, { status: 500 });
  };
}

/** Patch the global `fetch` for the duration of a test and
 *  restore it afterwards. Worker handlers don't accept an
 *  injected fetch so we mock the global. */
function withGithubFetch<T>(
  routes: Record<string, FetchResponseInit>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = makeGithubFetch(routes);
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

/** Convert a PKCS#8 `ArrayBuffer` to a wrapped base64 PEM body
 *  (no header / footer; caller wraps). 64-col wrapping matches
 *  what `openssl` emits, but the importer accepts unwrapped too. */
function arrayBufferToPemBody(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const b64 = btoa(binary);
  return b64.match(/.{1,64}/g)?.join("\n") ?? b64;
}

// ─── isPrivateRepoPlan ───────────────────────────────────────

describe("isPrivateRepoPlan", () => {
  it("treats free as non-private-eligible", () => {
    expect(isPrivateRepoPlan("free")).toBe(false);
    expect(isPrivateRepoPlan(undefined)).toBe(false);
    expect(isPrivateRepoPlan(null)).toBe(false);
  });

  it("allows pro / team / enterprise / early_supporter", () => {
    expect(isPrivateRepoPlan("pro")).toBe(true);
    expect(isPrivateRepoPlan("team")).toBe(true);
    expect(isPrivateRepoPlan("enterprise")).toBe(true);
    expect(isPrivateRepoPlan("early_supporter")).toBe(true);
  });

  it("treats unknown plan as ineligible", () => {
    expect(isPrivateRepoPlan("custom-plan")).toBe(false);
  });
});

// ─── /api/embed/load ─────────────────────────────────────────

describe("/api/embed/load", () => {
  function buildEnv(db: D1Database, kv: KVNamespace) {
    return makeMockEnv({ DB: db, SESSIONS: kv, OBJECTS: makeMockR2() });
  }

  function buildLoadUrl(
    opts: { repo?: string; pngPath?: string; annotationsPath?: string; returnUrl?: string } = {},
  ) {
    const params = new URLSearchParams({
      repo: opts.repo ?? "octocat/myrepo",
      pngPath: opts.pngPath ?? "docs/login.png",
      annotationsPath: opts.annotationsPath ?? "docs/login.annotations.yaml",
      return: opts.returnUrl ?? "https://docs.example.com/page",
      mode: "newTab",
      v: "1",
    });
    return `https://annot.work/api/embed/load?${params.toString()}`;
  }

  it("401s when no session cookie", async () => {
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    const env = buildEnv(db, kv);
    const res = await app.request(buildLoadUrl(), {}, env);
    expect(res.status).toBe(401);
  });

  it("400s on malformed repo slug", async () => {
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    await db
      .prepare(
        "INSERT INTO users (id, plan, created_at, updated_at, last_seen_at) VALUES (?, 'free', 0, 0, 0)",
      )
      .bind("user-1")
      .run();
    await db
      .prepare(
        "INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, 'My Workspace', ?, 0)",
      )
      .bind("ws-1", "user-1")
      .run();
    const sess = await seedSession({ kv, userId: "user-1", workspaceId: "ws-1" });
    const env = buildEnv(db, kv);
    const res = await app.request(
      buildLoadUrl({ repo: "not-a-valid-slug" }),
      { headers: { Cookie: sess.cookie } },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("400s on path traversal", async () => {
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    await db
      .prepare(
        "INSERT INTO users (id, plan, created_at, updated_at, last_seen_at) VALUES (?, 'free', 0, 0, 0)",
      )
      .bind("user-1")
      .run();
    await db
      .prepare(
        "INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, 'My Workspace', ?, 0)",
      )
      .bind("ws-1", "user-1")
      .run();
    const sess = await seedSession({ kv, userId: "user-1", workspaceId: "ws-1" });
    const env = buildEnv(db, kv);
    const res = await app.request(
      buildLoadUrl({ pngPath: "../../etc/passwd" }),
      { headers: { Cookie: sess.cookie } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("happy-path round-trip: real JWT sign → installation token mint → Contents API", async () => {
    // Generate a real RSA-2048 key for JWT signing. This proves
    // the PEM import + RSASSA-PKCS1-v1_5 sign path works end-to-
    // end without a brittle PEM fixture string.
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const pem = `-----BEGIN PRIVATE KEY-----\n${arrayBufferToPemBody(pkcs8)}\n-----END PRIVATE KEY-----\n`;

    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    // Seed user with pro plan so the private-repo path is allowed
    // (we also exercise public-repo via the same flow — the
    // plan-gate test is in the next case).
    await db
      .prepare(
        "INSERT INTO users (id, plan, created_at, updated_at, last_seen_at) VALUES (?, 'pro', 0, 0, 0)",
      )
      .bind("user-1")
      .run();
    await db
      .prepare(
        "INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, 'My Workspace', ?, 0)",
      )
      .bind("ws-1", "user-1")
      .run();
    await upsertGitHubInstallation(db, {
      id: 999,
      accountLogin: "octocat",
      accountType: "User",
      workspaceId: "ws-1",
    });
    const sess = await seedSession({ kv, userId: "user-1", workspaceId: "ws-1" });
    const env = buildEnv(db, kv);
    env.GITHUB_APP_PRIVATE_KEY = pem;
    env.GITHUB_APP_ID = "12345";

    // A matching allowlist must not block the load — exercises the
    // `rules !== null` positive path (the NULL-allowlist positive
    // path is covered by the private-repo plan-gate test below).
    await db
      .prepare("UPDATE github_installations SET target_paths_json = ? WHERE id = 999")
      .bind(JSON.stringify([{ repo: "octocat/myrepo", pathPrefix: "docs/" }]))
      .run();

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pngBase64 = base64UrlEncode(pngBytes).replaceAll("-", "+").replaceAll("_", "/");

    const res = await withGithubFetch(
      {
        "/app/installations/999/access_tokens": {
          body: {
            token: "ghs_test_token",
            expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          },
          status: 201,
        },
        "/repos/octocat/myrepo": {
          body: { private: false, default_branch: "main" },
        },
        "/contents/docs/login.png": {
          body: {
            sha: "png-sha-1",
            content: pngBase64,
            encoding: "base64",
          },
        },
        "/contents/docs/login.annotations.yaml": {
          body: {
            sha: "yaml-sha-1",
            content: btoa("version: 1\nshapes: []\n"),
            encoding: "base64",
          },
        },
      },
      async () => app.request(buildLoadUrl(), { headers: { Cookie: sess.cookie } }, env),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      installationId: number;
      pngBase64: string;
      annotationsYaml: string;
      repoState: { branch: string; pngSha: string; annotationsSha: string; private: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.installationId).toBe(999);
    expect(body.pngBase64).toBe(pngBase64);
    expect(body.annotationsYaml).toBe("version: 1\nshapes: []\n");
    expect(body.repoState.branch).toBe("main");
    expect(body.repoState.pngSha).toBe("png-sha-1");
    expect(body.repoState.annotationsSha).toBe("yaml-sha-1");
    expect(body.repoState.private).toBe(false);
  });

  it("403s on private repo when user is on free plan", async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const pem = `-----BEGIN PRIVATE KEY-----\n${arrayBufferToPemBody(pkcs8)}\n-----END PRIVATE KEY-----\n`;

    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    await db
      .prepare(
        "INSERT INTO users (id, plan, created_at, updated_at, last_seen_at) VALUES (?, 'free', 0, 0, 0)",
      )
      .bind("user-1")
      .run();
    await db
      .prepare(
        "INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, 'My Workspace', ?, 0)",
      )
      .bind("ws-1", "user-1")
      .run();
    await upsertGitHubInstallation(db, {
      id: 999,
      accountLogin: "octocat",
      accountType: "User",
      workspaceId: "ws-1",
    });
    const sess = await seedSession({ kv, userId: "user-1", workspaceId: "ws-1" });
    const env = buildEnv(db, kv);
    env.GITHUB_APP_PRIVATE_KEY = pem;
    env.GITHUB_APP_ID = "12345";

    const res = await withGithubFetch(
      {
        "/app/installations/999/access_tokens": {
          body: {
            token: "ghs_test_token",
            expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          },
          status: 201,
        },
        "/repos/octocat/myrepo": {
          body: { private: true, default_branch: "main" },
        },
      },
      async () => app.request(buildLoadUrl(), { headers: { Cookie: sess.cookie } }, env),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; requiredPlan: string };
    expect(body.error).toBe("plan_required");
    expect(body.requiredPlan).toBe("pro");
  });

  it("403s when the installation is unclaimed (no workspace has claimed it)", async () => {
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    await db
      .prepare(
        "INSERT INTO users (id, plan, created_at, updated_at, last_seen_at) VALUES (?, 'pro', 0, 0, 0)",
      )
      .bind("user-1")
      .run();
    await db
      .prepare(
        "INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, 'My Workspace', ?, 0)",
      )
      .bind("ws-1", "user-1")
      .run();
    // No workspaceId → workspace_id stays NULL (unclaimed).
    await upsertGitHubInstallation(db, {
      id: 999,
      accountLogin: "octocat",
      accountType: "User",
    });
    const sess = await seedSession({ kv, userId: "user-1", workspaceId: "ws-1" });
    const env = buildEnv(db, kv);
    // No GitHub fetch mocks: the check fires before any token mint.
    const res = await app.request(buildLoadUrl(), { headers: { Cookie: sess.cookie } }, env);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("not_authorised");
    expect(body.message).toContain("not claimed");
  });

  it("403s when the installation is claimed by another workspace", async () => {
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    await db
      .prepare(
        "INSERT INTO users (id, plan, created_at, updated_at, last_seen_at) VALUES (?, 'pro', 0, 0, 0)",
      )
      .bind("user-1")
      .run();
    await db
      .prepare(
        "INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, 'My Workspace', ?, 0)",
      )
      .bind("ws-1", "user-1")
      .run();
    await upsertGitHubInstallation(db, {
      id: 999,
      accountLogin: "octocat",
      accountType: "User",
      workspaceId: "ws-other",
    });
    const sess = await seedSession({ kv, userId: "user-1", workspaceId: "ws-1" });
    const env = buildEnv(db, kv);
    const res = await app.request(buildLoadUrl(), { headers: { Cookie: sess.cookie } }, env);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_authorised");
  });

  it("403s when a requested path is outside the target_paths_json allowlist", async () => {
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    await db
      .prepare(
        "INSERT INTO users (id, plan, created_at, updated_at, last_seen_at) VALUES (?, 'pro', 0, 0, 0)",
      )
      .bind("user-1")
      .run();
    await db
      .prepare(
        "INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, 'My Workspace', ?, 0)",
      )
      .bind("ws-1", "user-1")
      .run();
    await upsertGitHubInstallation(db, {
      id: 999,
      accountLogin: "octocat",
      accountType: "User",
      workspaceId: "ws-1",
    });
    await db
      .prepare("UPDATE github_installations SET target_paths_json = ? WHERE id = 999")
      .bind(JSON.stringify([{ repo: "octocat/myrepo", pathPrefix: "docs/allowed/" }]))
      .run();
    const sess = await seedSession({ kv, userId: "user-1", workspaceId: "ws-1" });
    const env = buildEnv(db, kv);
    // Default paths live under docs/, not docs/allowed/.
    const res = await app.request(buildLoadUrl(), { headers: { Cookie: sess.cookie } }, env);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("path_not_allowed");
  });

  it("404s when no installation is found for the repo owner", async () => {
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    await db
      .prepare(
        "INSERT INTO users (id, plan, created_at, updated_at, last_seen_at) VALUES (?, 'free', 0, 0, 0)",
      )
      .bind("user-1")
      .run();
    await db
      .prepare(
        "INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, 'My Workspace', ?, 0)",
      )
      .bind("ws-1", "user-1")
      .run();
    const sess = await seedSession({ kv, userId: "user-1", workspaceId: "ws-1" });
    const env = buildEnv(db, kv);
    const res = await app.request(buildLoadUrl(), { headers: { Cookie: sess.cookie } }, env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_installation");
  });
});
