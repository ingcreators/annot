// Tests for `embed/commit.ts` — Phase 6 follow-up 5y-4.

import { describe, expect, it } from "vitest";
import app from "../index.js";
import { createSession, type SessionRecord } from "../session.js";
import { makeMockD1Sqlite, makeMockEnv, makeMockKv } from "../test-helpers.js";
import { upsertGitHubInstallation } from "./github-app.js";

// ─── Helpers ─────────────────────────────────────────────────

async function seedSession(opts: {
  kv: KVNamespace;
  userId: string;
  workspaceId: string;
}): Promise<string> {
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
  return `annot_session=${token}`;
}

async function seedRSAKey(): Promise<string> {
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
  const bytes = new Uint8Array(pkcs8);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const b64 = btoa(binary);
  const wrapped = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

interface FetchRouteInit {
  status?: number;
  body?: unknown;
}

function makeGithubFetch(routes: Record<string, FetchRouteInit>): typeof fetch {
  const sorted = Object.entries(routes).sort(([a], [b]) => b.length - a.length);
  return async (input: Request | URL | string): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    for (const [pattern, init] of sorted) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(init.body ?? {}), {
          status: init.status ?? 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response(`No fixture for ${url}`, { status: 500 });
  };
}

function withGithubFetch<T>(
  routes: Record<string, FetchRouteInit>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = makeGithubFetch(routes);
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

async function seedDb(): Promise<{ db: D1Database; userId: string; workspaceId: string }> {
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
  return { db, userId: "user-1", workspaceId: "ws-1" };
}

// ─── Tests ───────────────────────────────────────────────────

describe("/api/embed/commit", () => {
  it("401s when no session cookie", async () => {
    const { db } = await seedDb();
    const env = makeMockEnv({ DB: db, SESSIONS: makeMockKv() });
    const res = await app.request(
      "https://annot.work/api/embed/commit",
      { method: "POST", body: JSON.stringify({}) },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("400s on missing fields", async () => {
    const { db, userId, workspaceId } = await seedDb();
    const kv = makeMockKv();
    const cookie = await seedSession({ kv, userId, workspaceId });
    const env = makeMockEnv({ DB: db, SESSIONS: kv });
    const res = await app.request(
      "https://annot.work/api/embed/commit",
      { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ repo: "o/r" }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400s on malformed repo slug", async () => {
    const { db, userId, workspaceId } = await seedDb();
    const kv = makeMockKv();
    const cookie = await seedSession({ kv, userId, workspaceId });
    const env = makeMockEnv({ DB: db, SESSIONS: kv });
    const res = await app.request(
      "https://annot.work/api/embed/commit",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: 1,
          repo: "no-slash",
          pngPath: "a.png",
          annotationsPath: "a.yaml",
          branch: "main",
          annotationsYaml: "v: 1",
          annotationsSha: "x",
          editId: "e1",
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("404s when installation is missing", async () => {
    const { db, userId, workspaceId } = await seedDb();
    const kv = makeMockKv();
    const cookie = await seedSession({ kv, userId, workspaceId });
    const env = makeMockEnv({ DB: db, SESSIONS: kv });
    const res = await app.request(
      "https://annot.work/api/embed/commit",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: 999,
          repo: "octocat/myrepo",
          pngPath: "a.png",
          annotationsPath: "a.yaml",
          branch: "main",
          annotationsYaml: "v: 1",
          annotationsSha: "x",
          editId: "e1",
        }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("direct-push happy path: commits annotations + emits audit", async () => {
    const { db, userId, workspaceId } = await seedDb();
    const kv = makeMockKv();
    const cookie = await seedSession({ kv, userId, workspaceId });
    await upsertGitHubInstallation(db, {
      id: 999,
      accountLogin: "octocat",
      accountType: "User",
      repoPolicy: "direct-push",
    });
    const env = makeMockEnv({ DB: db, SESSIONS: kv });
    env.GITHUB_APP_PRIVATE_KEY = await seedRSAKey();
    env.GITHUB_APP_ID = "12345";
    const res = await withGithubFetch(
      {
        "/app/installations/999/access_tokens": {
          body: { token: "ghs_test", expires_at: new Date(Date.now() + 60_000_000).toISOString() },
          status: 201,
        },
        "/contents/a.yaml": {
          body: { content: { sha: "blob-sha" }, commit: { sha: "commit-sha-1" } },
          status: 200,
        },
      },
      async () =>
        app.request(
          "https://annot.work/api/embed/commit",
          {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({
              installationId: 999,
              repo: "octocat/myrepo",
              pngPath: "a.png",
              annotationsPath: "a.yaml",
              branch: "main",
              annotationsYaml: "version: 1\noverlays: []\n",
              annotationsSha: "old-blob-sha",
              editId: "e-abc",
            }),
          },
          env,
        ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      commitSha: string;
      branch: string;
      policy: string;
      editId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.commitSha).toBe("commit-sha-1");
    expect(body.branch).toBe("main");
    expect(body.policy).toBe("direct-push");
    expect(body.editId).toBe("e-abc");
    // Audit row written.
    const audit = await db
      .prepare("SELECT action, metadata_json FROM audit_events WHERE action = ?")
      .bind("embed_commit")
      .first<{ action: string; metadata_json: string }>();
    expect(audit?.action).toBe("embed_commit");
    const meta = JSON.parse(audit?.metadata_json ?? "{}") as { policy: string; editId: string };
    expect(meta.policy).toBe("direct-push");
    expect(meta.editId).toBe("e-abc");
  });

  it("pr-mode happy path: creates branch + commit + PR", async () => {
    const { db, userId, workspaceId } = await seedDb();
    const kv = makeMockKv();
    const cookie = await seedSession({ kv, userId, workspaceId });
    await upsertGitHubInstallation(db, {
      id: 999,
      accountLogin: "octocat",
      accountType: "User",
      // pr-mode is the default; explicit for clarity.
      repoPolicy: "pr-mode",
    });
    const env = makeMockEnv({ DB: db, SESSIONS: kv });
    env.GITHUB_APP_PRIVATE_KEY = await seedRSAKey();
    env.GITHUB_APP_ID = "12345";
    const res = await withGithubFetch(
      {
        "/app/installations/999/access_tokens": {
          body: { token: "ghs_test", expires_at: new Date(Date.now() + 60_000_000).toISOString() },
          status: 201,
        },
        "/git/ref/heads/main": { body: { object: { sha: "main-head-sha" } }, status: 200 },
        "/git/refs": { body: { ref: "refs/heads/annot-edit/e-abc" }, status: 201 },
        "/contents/a.yaml": {
          body: { content: { sha: "blob-sha" }, commit: { sha: "commit-sha-1" } },
          status: 200,
        },
        "/pulls": {
          body: { html_url: "https://github.com/octocat/myrepo/pull/7" },
          status: 201,
        },
      },
      async () =>
        app.request(
          "https://annot.work/api/embed/commit",
          {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({
              installationId: 999,
              repo: "octocat/myrepo",
              pngPath: "a.png",
              annotationsPath: "a.yaml",
              branch: "main",
              annotationsYaml: "version: 1\noverlays: []\n",
              annotationsSha: "old-blob-sha",
              editId: "e-abc",
            }),
          },
          env,
        ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      branch: string;
      prUrl: string;
      policy: string;
    };
    expect(body.ok).toBe(true);
    expect(body.branch).toBe("annot-edit/e-abc");
    expect(body.prUrl).toBe("https://github.com/octocat/myrepo/pull/7");
    expect(body.policy).toBe("pr-mode");
  });

  it("409 from GitHub maps to conflict response", async () => {
    const { db, userId, workspaceId } = await seedDb();
    const kv = makeMockKv();
    const cookie = await seedSession({ kv, userId, workspaceId });
    await upsertGitHubInstallation(db, {
      id: 999,
      accountLogin: "octocat",
      accountType: "User",
      repoPolicy: "direct-push",
    });
    const env = makeMockEnv({ DB: db, SESSIONS: kv });
    env.GITHUB_APP_PRIVATE_KEY = await seedRSAKey();
    env.GITHUB_APP_ID = "12345";
    const res = await withGithubFetch(
      {
        "/app/installations/999/access_tokens": {
          body: { token: "ghs_test", expires_at: new Date(Date.now() + 60_000_000).toISOString() },
          status: 201,
        },
        "/contents/a.yaml": { body: { message: "sha mismatch" }, status: 409 },
      },
      async () =>
        app.request(
          "https://annot.work/api/embed/commit",
          {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({
              installationId: 999,
              repo: "octocat/myrepo",
              pngPath: "a.png",
              annotationsPath: "a.yaml",
              branch: "main",
              annotationsYaml: "v: 1",
              annotationsSha: "stale-sha",
              editId: "e-abc",
            }),
          },
          env,
        ),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("conflict");
  });
});
