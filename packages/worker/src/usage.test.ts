// Integration tests for `/api/usage`. Verifies the workspace
// usage / plan / limits shape exposed to the PWA for the storage
// progress bar + "approaching limit" banners.

import { describe, expect, it } from "vitest";
import app from "./index.js";
import { createSession, type SessionRecord } from "./session.js";
import { makeMockD1Sqlite, makeMockEnv, makeMockKv, makeMockR2 } from "./test-helpers.js";
import { findOrCreateUserFromProvider } from "./user-repo.js";

const PROFILE = {
  provider: "github" as const,
  providerUserId: "usage-test",
  email: null,
  displayName: "Usage Test",
  avatarUrl: "",
};

async function setupAuthed(plan: "free" | "pro" | "team" = "free") {
  const kv = makeMockKv();
  const db = makeMockD1Sqlite();
  const r2 = makeMockR2();
  const env = makeMockEnv({ SESSIONS: kv, DB: db, OBJECTS: r2 });
  const upserted = await findOrCreateUserFromProvider(db, PROFILE);
  if (plan !== "free") {
    await db
      .prepare("UPDATE workspaces SET plan = ? WHERE id = ?")
      .bind(plan, upserted.workspace.id)
      .run();
  }
  const session: SessionRecord = {
    provider: "github",
    providerUserId: PROFILE.providerUserId,
    login: "test-user",
    name: PROFILE.displayName,
    avatarUrl: "",
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    userId: upserted.user.id,
    workspaceId: upserted.workspace.id,
  };
  const token = await createSession(kv, session);
  return {
    env,
    cookie: `annot_session=${token}`,
    workspaceId: upserted.workspace.id,
  };
}

describe("/api/usage", () => {
  it("returns 401 without a session cookie", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/usage", {}, env);
    expect(res.status).toBe(401);
  });

  it("returns zero usage + free plan limits for an empty workspace", async () => {
    const { env, cookie, workspaceId } = await setupAuthed();
    const res = await app.request("/api/usage", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      workspaceId: string;
      plan: string;
      usage: { storageBytes: number; documentCount: number };
      limits: { storageBytes: number | null; activeDocuments: number | null };
    };
    expect(body.ok).toBe(true);
    expect(body.workspaceId).toBe(workspaceId);
    expect(body.plan).toBe("free");
    expect(body.usage).toEqual({ storageBytes: 0, documentCount: 0 });
    expect(body.limits.storageBytes).toBe(5_000_000_000);
    expect(body.limits.activeDocuments).toBe(50);
  });

  it("reflects current usage after an upload", async () => {
    const { env, cookie } = await setupAuthed();
    await app.request(
      "/api/images?path=tiny.png",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "image/png" },
        body: new Uint8Array(1000),
      },
      env,
    );
    const res = await app.request("/api/usage", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as {
      usage: { storageBytes: number };
    };
    expect(body.usage.storageBytes).toBe(1000);
  });

  it("returns null for unlimited limits on the pro plan", async () => {
    const { env, cookie } = await setupAuthed("pro");
    const res = await app.request("/api/usage", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as {
      plan: string;
      limits: { storageBytes: number | null; activeDocuments: number | null };
    };
    expect(body.plan).toBe("pro");
    expect(body.limits.storageBytes).toBe(50_000_000_000);
    // activeDocuments is Infinity on pro → null in JSON wire form.
    expect(body.limits.activeDocuments).toBeNull();
  });
});
