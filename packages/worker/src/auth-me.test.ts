import { describe, expect, it } from "vitest";
import app from "./index.js";
import { createSession, type SessionRecord } from "./session.js";
import { makeMockD1Sqlite, makeMockEnv, makeMockKv } from "./test-helpers.js";
import { findOrCreateUserFromProvider } from "./user-repo.js";

const FAKE_RECORD: SessionRecord = {
  provider: "github",
  providerUserId: "12345",
  login: "octocat",
  name: "The Octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/12345",
  createdAt: "2026-05-18T00:00:00.000Z",
  lastSeenAt: "2026-05-18T00:00:00.000Z",
};

// Pre-Phase-3 record (no userId/workspaceId) — proves the
// optionality is honoured for sessions migrated through a redeploy.
const LEGACY_RECORD: SessionRecord = { ...FAKE_RECORD };

// Phase-3-aware record with userId + workspaceId.
function recordWithIds(userId: string, workspaceId: string): SessionRecord {
  return { ...FAKE_RECORD, userId, workspaceId };
}

describe("GET /api/auth/me", () => {
  it("returns 401 no_session when no cookie present", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/me", {}, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_session");
  });

  it("returns 401 expired_session when cookie present but record missing", async () => {
    const env = makeMockEnv();
    const res = await app.request(
      "/api/auth/me",
      { headers: { Cookie: "annot_session=nonexistent-token" } },
      env,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("expired_session");
  });

  it("returns 200 with user info when session is valid", async () => {
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const token = await createSession(kv, FAKE_RECORD);
    const res = await app.request(
      "/api/auth/me",
      { headers: { Cookie: `annot_session=${token}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      user: {
        provider: string;
        providerUserId: string;
        login: string;
        name: string;
        avatarUrl: string;
        userId?: string;
        workspaceId?: string;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.user.provider).toBe("github");
    expect(body.user.providerUserId).toBe("12345");
    expect(body.user.login).toBe("octocat");
    expect(body.user.name).toBe("The Octocat");
    expect(body.user.avatarUrl).toBe(FAKE_RECORD.avatarUrl);
  });

  it("Phase 3: surfaces userId / workspaceId when the session carries them", async () => {
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    const env = makeMockEnv({ SESSIONS: kv, DB: db });
    const upserted = await findOrCreateUserFromProvider(db, {
      provider: "github",
      providerUserId: "12345",
      email: null,
      displayName: "The Octocat",
      avatarUrl: FAKE_RECORD.avatarUrl,
    });
    const token = await createSession(kv, recordWithIds(upserted.user.id, upserted.workspace.id));
    const res = await app.request(
      "/api/auth/me",
      { headers: { Cookie: `annot_session=${token}` } },
      env,
    );
    const body = (await res.json()) as {
      user: { userId?: string; workspaceId?: string };
    };
    expect(body.user.userId).toBe(upserted.user.id);
    expect(body.user.workspaceId).toBe(upserted.workspace.id);
  });

  it("Phase 3: legacy session (no userId) still returns 200 without the IDs", async () => {
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const token = await createSession(kv, LEGACY_RECORD);
    const res = await app.request(
      "/api/auth/me",
      { headers: { Cookie: `annot_session=${token}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { userId?: string; workspaceId?: string };
    };
    expect(body.user.userId).toBeUndefined();
    expect(body.user.workspaceId).toBeUndefined();
  });

  it("Phase 3: touches users.last_seen_at when session carries userId", async () => {
    const kv = makeMockKv();
    const db = makeMockD1Sqlite();
    const env = makeMockEnv({ SESSIONS: kv, DB: db });
    const upserted = await findOrCreateUserFromProvider(db, {
      provider: "github",
      providerUserId: "12345",
      email: null,
      displayName: "The Octocat",
      avatarUrl: FAKE_RECORD.avatarUrl,
    });
    const before = upserted.user.last_seen_at;

    const token = await createSession(kv, recordWithIds(upserted.user.id, upserted.workspace.id));
    // Sleep so the timestamp moves forward by at least 1ms.
    await new Promise((r) => setTimeout(r, 5));
    await app.request("/api/auth/me", { headers: { Cookie: `annot_session=${token}` } }, env);

    const after = await db
      .prepare("SELECT last_seen_at FROM users WHERE id = ?")
      .bind(upserted.user.id)
      .first<{ last_seen_at: number }>();
    expect(after?.last_seen_at).toBeGreaterThan(before);
  });

  it("does not expose createdAt / lastSeenAt to the client", async () => {
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const token = await createSession(kv, FAKE_RECORD);
    const res = await app.request(
      "/api/auth/me",
      { headers: { Cookie: `annot_session=${token}` } },
      env,
    );
    const body = (await res.json()) as Record<string, unknown>;
    const user = body.user as Record<string, unknown>;
    expect(user.createdAt).toBeUndefined();
    expect(user.lastSeenAt).toBeUndefined();
  });

  it("ignores unrelated cookies", async () => {
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const token = await createSession(kv, FAKE_RECORD);
    const res = await app.request(
      "/api/auth/me",
      {
        headers: {
          Cookie: `tracking=val; annot_session=${token}; theme=dark`,
        },
      },
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/auth/logout", () => {
  it("returns 204 and clears the session cookie", async () => {
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const token = await createSession(kv, FAKE_RECORD);

    const res = await app.request(
      "/api/auth/logout",
      {
        method: "POST",
        headers: { Cookie: `annot_session=${token}` },
      },
      env,
    );
    expect(res.status).toBe(204);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("annot_session=;");
    expect(cookie).toContain("Max-Age=0");
  });

  it("deletes the session from KV (subsequent /me returns 401)", async () => {
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const token = await createSession(kv, FAKE_RECORD);

    await app.request(
      "/api/auth/logout",
      { method: "POST", headers: { Cookie: `annot_session=${token}` } },
      env,
    );

    // Verify the session is actually gone.
    const meRes = await app.request(
      "/api/auth/me",
      { headers: { Cookie: `annot_session=${token}` } },
      env,
    );
    expect(meRes.status).toBe(401);
  });

  it("returns 204 idempotently when no cookie is present", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/logout", { method: "POST" }, env);
    expect(res.status).toBe(204);
    // Cleared cookie is still emitted so the browser drops any
    // stale value it might have.
    expect(res.headers.get("set-cookie")).toContain("annot_session=;");
  });

  it("returns 204 when cookie present but session already gone", async () => {
    const env = makeMockEnv();
    const res = await app.request(
      "/api/auth/logout",
      {
        method: "POST",
        headers: { Cookie: "annot_session=ghost-token" },
      },
      env,
    );
    expect(res.status).toBe(204);
  });

  it("GET /api/auth/logout falls through to 404 (POST-only)", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/logout", {}, env);
    expect(res.status).toBe(404);
  });
});
