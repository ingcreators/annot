// Tests for `embed/build-trigger.ts` — Phase 6 follow-up 5z-1.

import { describe, expect, it } from "vitest";
import app from "../index.js";
import { createSession, type SessionRecord } from "../session.js";
import { makeMockD1Sqlite, makeMockEnv, makeMockKv } from "../test-helpers.js";
import { pingBuildHook } from "./build-trigger.js";
import { type GitHubInstallationRow, upsertGitHubInstallation } from "./github-app.js";

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

describe("pingBuildHook", () => {
  function makeRow(overrides: Partial<GitHubInstallationRow>): GitHubInstallationRow {
    return {
      id: 1,
      account_login: "octocat",
      account_type: "User",
      workspace_id: "ws-1",
      installed_at: 0,
      suspended_at: null,
      repo_policy: "pr-mode",
      default_branch_override: null,
      build_hook_url: null,
      target_paths_json: null,
      ...overrides,
    };
  }

  it("returns pinged:false when no hook URL is configured", async () => {
    const result = await pingBuildHook({ installation: makeRow({ build_hook_url: null }) });
    expect(result).toEqual({ pinged: false });
  });

  it("returns success on a 200 response (single attempt)", async () => {
    const calls: string[] = [];
    const result = await pingBuildHook({
      installation: makeRow({ build_hook_url: "https://example.com/hook" }),
      fetchImpl: (async (input: Request | URL | string) => {
        calls.push(typeof input === "string" ? input : input.toString());
        return new Response("", { status: 200 });
      }) as typeof fetch,
    });
    expect(result).toEqual({ pinged: true, status: 200, attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it("does not retry on 4xx (customer-configuration failure)", async () => {
    let attempts = 0;
    const result = await pingBuildHook({
      installation: makeRow({ build_hook_url: "https://example.com/hook" }),
      fetchImpl: (async () => {
        attempts += 1;
        return new Response("", { status: 404 });
      }) as typeof fetch,
    });
    expect(result.pinged).toBe(true);
    if (result.pinged) {
      expect(result.status).toBe(404);
      expect(result.attempts).toBe(1);
    }
    expect(attempts).toBe(1);
  });

  it("retries up to 3 times on 5xx", async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const result = await pingBuildHook({
      installation: makeRow({ build_hook_url: "https://example.com/hook" }),
      fetchImpl: (async () => {
        attempts += 1;
        return new Response("", { status: 502 });
      }) as typeof fetch,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([30_000, 30_000]);
    expect(result.pinged).toBe(true);
    if (result.pinged) {
      expect(result.status).toBe(502);
      expect(result.attempts).toBe(3);
    }
  });

  it("absorbs network errors and retries", async () => {
    let attempts = 0;
    const result = await pingBuildHook({
      installation: makeRow({ build_hook_url: "https://example.com/hook" }),
      fetchImpl: (async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError("network");
        return new Response("", { status: 200 });
      }) as typeof fetch,
      sleepImpl: async () => undefined,
    });
    expect(result.pinged).toBe(true);
    if (result.pinged) {
      expect(result.status).toBe(200);
      expect(result.attempts).toBe(2);
    }
  });
});

describe("/api/embed/installations/:id PATCH", () => {
  it("401 without session", async () => {
    const { db } = await seedDb();
    await upsertGitHubInstallation(db, {
      id: 99,
      accountLogin: "octocat",
      accountType: "User",
    });
    const env = makeMockEnv({ DB: db, SESSIONS: makeMockKv() });
    const res = await app.request(
      "https://annot.work/api/embed/installations/99",
      { method: "PATCH", body: JSON.stringify({ buildHookUrl: "https://x" }) },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("404 on unknown installation", async () => {
    const { db, userId, workspaceId } = await seedDb();
    const kv = makeMockKv();
    const cookie = await seedSession({ kv, userId, workspaceId });
    const env = makeMockEnv({ DB: db, SESSIONS: kv });
    const res = await app.request(
      "https://annot.work/api/embed/installations/999",
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ buildHookUrl: "https://x" }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("claims an unclaimed installation + updates build_hook_url", async () => {
    const { db, userId, workspaceId } = await seedDb();
    const kv = makeMockKv();
    const cookie = await seedSession({ kv, userId, workspaceId });
    await upsertGitHubInstallation(db, {
      id: 50,
      accountLogin: "octocat",
      accountType: "User",
      workspaceId: null,
    });
    const env = makeMockEnv({ DB: db, SESSIONS: kv });
    const res = await app.request(
      "https://annot.work/api/embed/installations/50",
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ buildHookUrl: "https://api.cloudflare.com/.../deploy" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      installation: { id: number; workspace_id: string; build_hook_url: string };
    };
    expect(body.ok).toBe(true);
    expect(body.installation.workspace_id).toBe(workspaceId);
    expect(body.installation.build_hook_url).toBe("https://api.cloudflare.com/.../deploy");
    const audit = await db
      .prepare("SELECT action FROM audit_events WHERE action = ?")
      .bind("embed_installation_patch")
      .first<{ action: string }>();
    expect(audit?.action).toBe("embed_installation_patch");
  });

  it("403 when installation is claimed by another workspace", async () => {
    const { db, userId, workspaceId } = await seedDb();
    const kv = makeMockKv();
    const cookie = await seedSession({ kv, userId, workspaceId });
    await upsertGitHubInstallation(db, {
      id: 51,
      accountLogin: "other",
      accountType: "User",
      workspaceId: "other-workspace",
    });
    const env = makeMockEnv({ DB: db, SESSIONS: kv });
    const res = await app.request(
      "https://annot.work/api/embed/installations/51",
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ buildHookUrl: "https://x" }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("400 on invalid repoPolicy", async () => {
    const { db, userId, workspaceId } = await seedDb();
    const kv = makeMockKv();
    const cookie = await seedSession({ kv, userId, workspaceId });
    await upsertGitHubInstallation(db, {
      id: 52,
      accountLogin: "octocat",
      accountType: "User",
    });
    const env = makeMockEnv({ DB: db, SESSIONS: kv });
    const res = await app.request(
      "https://annot.work/api/embed/installations/52",
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ repoPolicy: "bogus" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});
