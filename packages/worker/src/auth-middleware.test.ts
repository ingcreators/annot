// Tests for `requireAuth` — exercises the auth check via a
// dummy Hono route that calls it and surfaces the result back as
// a JSON payload. Mirrors how real handlers consume the helper.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requireAuth } from "./auth-middleware.js";
import type { Env } from "./index.js";
import { createSession, type SessionRecord } from "./session.js";
import { makeMockEnv, makeMockKv } from "./test-helpers.js";

const FAKE_RECORD: SessionRecord = {
  provider: "github",
  providerUserId: "12345",
  login: "octocat",
  name: "The Octocat",
  avatarUrl: "",
  createdAt: "2026-05-18T00:00:00.000Z",
  lastSeenAt: "2026-05-18T00:00:00.000Z",
  userId: "user-uuid",
  workspaceId: "workspace-uuid",
};

const LEGACY_RECORD: SessionRecord = {
  ...FAKE_RECORD,
  userId: undefined,
  workspaceId: undefined,
};

function appWithTestRoute() {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/test", async (c) => {
    const auth = await requireAuth(c);
    if (auth instanceof Response) return auth;
    return c.json({
      ok: true,
      userId: auth.userId,
      workspaceId: auth.workspaceId,
    });
  });
  return app;
}

describe("requireAuth", () => {
  it("returns 401 no_session when no cookie", async () => {
    const app = appWithTestRoute();
    const env = makeMockEnv();
    const res = await app.request("/test", {}, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_session");
  });

  it("returns 401 expired_session when cookie has no KV record", async () => {
    const app = appWithTestRoute();
    const env = makeMockEnv();
    const res = await app.request(
      "/test",
      { headers: { Cookie: "annot_session=nonexistent" } },
      env,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("expired_session");
  });

  it("returns 401 legacy_session_relogin_required for pre-Phase-3 sessions", async () => {
    const app = appWithTestRoute();
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const token = await createSession(kv, LEGACY_RECORD);
    const res = await app.request("/test", { headers: { Cookie: `annot_session=${token}` } }, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("legacy_session_relogin_required");
  });

  it("surfaces userId / workspaceId for Phase 3-aware sessions", async () => {
    const app = appWithTestRoute();
    const kv = makeMockKv();
    const env = makeMockEnv({ SESSIONS: kv });
    const token = await createSession(kv, FAKE_RECORD);
    const res = await app.request("/test", { headers: { Cookie: `annot_session=${token}` } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      userId: string;
      workspaceId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.userId).toBe("user-uuid");
    expect(body.workspaceId).toBe("workspace-uuid");
  });
});
