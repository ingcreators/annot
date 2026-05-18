// End-to-end tests for `/api/shares/*`. SQLite-backed D1 +
// in-memory R2 + KV; both authenticated owner paths and anonymous
// public paths covered.

import { describe, expect, it } from "vitest";
import app from "./index.js";
import { createSession, type SessionRecord } from "./session.js";
import { makeMockD1Sqlite, makeMockEnv, makeMockKv, makeMockR2 } from "./test-helpers.js";
import { findOrCreateUserFromProvider } from "./user-repo.js";

const PROFILE = {
  provider: "github" as const,
  providerUserId: "shares-test",
  email: null,
  displayName: "Shares Test",
  avatarUrl: "",
};

interface AuthedEnv {
  env: ReturnType<typeof makeMockEnv>;
  cookie: string;
  userId: string;
  workspaceId: string;
}

async function setupAuthed(providerUserId: string = PROFILE.providerUserId): Promise<AuthedEnv> {
  const kv = makeMockKv();
  const db = makeMockD1Sqlite();
  const r2 = makeMockR2();
  const env = makeMockEnv({ SESSIONS: kv, DB: db, OBJECTS: r2 });
  const upserted = await findOrCreateUserFromProvider(db, { ...PROFILE, providerUserId });
  const session: SessionRecord = {
    provider: "github",
    providerUserId,
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
    userId: upserted.user.id,
    workspaceId: upserted.workspace.id,
  };
}

const TINY_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DOC_HTML = "<!doctype html><html><body>shared doc</body></html>";

async function uploadImage(authed: AuthedEnv, path: string): Promise<string> {
  const res = await app.request(
    `/api/images?path=${encodeURIComponent(path)}`,
    {
      method: "POST",
      headers: { Cookie: authed.cookie, "Content-Type": "image/png" },
      body: TINY_PNG,
    },
    authed.env,
  );
  const body = (await res.json()) as { image: { id: string } };
  return body.image.id;
}

async function uploadDocument(authed: AuthedEnv, path: string): Promise<string> {
  const res = await app.request(
    `/api/documents?path=${encodeURIComponent(path)}`,
    {
      method: "POST",
      headers: { Cookie: authed.cookie, "Content-Type": "text/html" },
      body: DOC_HTML,
    },
    authed.env,
  );
  const body = (await res.json()) as { document: { id: string } };
  return body.document.id;
}

// ─── Auth gates ─────────────────────────────────────────────────

describe("/api/shares — auth gates", () => {
  it("POST returns 401 with no cookie", async () => {
    const env = makeMockEnv();
    const res = await app.request(
      "/api/shares",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType: "image", resourceId: "x" }),
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("GET list returns 401 with no cookie", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/shares", {}, env);
    expect(res.status).toBe(401);
  });

  it("DELETE returns 401 with no cookie", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/shares/some-token", { method: "DELETE" }, env);
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/shares ───────────────────────────────────────────

describe("POST /api/shares", () => {
  it("creates an image share + returns the token", async () => {
    const authed = await setupAuthed();
    const imageId = await uploadImage(authed, "shared.png");
    const res = await app.request(
      "/api/shares",
      {
        method: "POST",
        headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType: "image", resourceId: imageId }),
      },
      authed.env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      share: { token: string; resourceType: string; resourceId: string };
    };
    expect(body.ok).toBe(true);
    expect(body.share.resourceType).toBe("image");
    expect(body.share.resourceId).toBe(imageId);
    // Token is the 22-char URL-safe slug.
    expect(body.share.token).toMatch(/^[A-Za-z0-9]{22}$/);
  });

  it("creates a document share", async () => {
    const authed = await setupAuthed();
    const docId = await uploadDocument(authed, "shared.annot.html");
    const res = await app.request(
      "/api/shares",
      {
        method: "POST",
        headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType: "document", resourceId: docId }),
      },
      authed.env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { share: { resourceType: string } };
    expect(body.share.resourceType).toBe("document");
  });

  it("returns 400 for malformed body", async () => {
    const authed = await setupAuthed();
    const res = await app.request(
      "/api/shares",
      {
        method: "POST",
        headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
        body: "not json",
      },
      authed.env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown resourceType", async () => {
    const authed = await setupAuthed();
    const res = await app.request(
      "/api/shares",
      {
        method: "POST",
        headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType: "video", resourceId: "x" }),
      },
      authed.env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent image", async () => {
    const authed = await setupAuthed();
    const res = await app.request(
      "/api/shares",
      {
        method: "POST",
        headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType: "image", resourceId: "nonexistent" }),
      },
      authed.env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when sharing another workspace's image", async () => {
    const a = await setupAuthed("user-a");
    const b = await setupAuthed("user-b");
    const imageId = await uploadImage(a, "private.png");
    // User B tries to share user A's image (using A's id).
    const res = await app.request(
      "/api/shares",
      {
        method: "POST",
        headers: { Cookie: b.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType: "image", resourceId: imageId }),
      },
      b.env,
    );
    // But the env is B's. The image lives in A's DB. So
    // findImageById against B's workspace returns null → 404.
    // Note: this test verifies the workspace scoping more than
    // cross-DB; with separate DBs the image really doesn't
    // exist in B's view.
    expect(res.status).toBe(404);
  });

  it("returns 413 quota_exceeded when over the share cap", async () => {
    const authed = await setupAuthed();
    const imageId = await uploadImage(authed, "img.png");
    // Seed 30 existing shares (the free cap).
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      await authed.env.DB.prepare(
        `INSERT INTO share_links (
          id, resource_type, resource_id, workspace_id,
          created_by_user_id, view_count, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)`,
      )
        .bind(`seed-token-${i}`, "image", imageId, authed.workspaceId, authed.userId, now)
        .run();
    }
    const res = await app.request(
      "/api/shares",
      {
        method: "POST",
        headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType: "image", resourceId: imageId }),
      },
      authed.env,
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; exceeded?: string };
    expect(body.error).toBe("quota_exceeded");
    expect(body.exceeded).toBe("shares");
  });
});

// ─── GET /api/shares (auth) ─────────────────────────────────────

describe("GET /api/shares", () => {
  it("lists active shares for the workspace", async () => {
    const authed = await setupAuthed();
    const imageId = await uploadImage(authed, "img.png");
    for (let i = 0; i < 3; i++) {
      await app.request(
        "/api/shares",
        {
          method: "POST",
          headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ resourceType: "image", resourceId: imageId }),
        },
        authed.env,
      );
      await new Promise((r) => setTimeout(r, 1));
    }
    const res = await app.request(
      "/api/shares",
      { headers: { Cookie: authed.cookie } },
      authed.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      count: number;
      shares: { token: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(3);
    expect(body.shares.every((s) => s.token.length === 22)).toBe(true);
  });

  it("excludes revoked shares", async () => {
    const authed = await setupAuthed();
    const imageId = await uploadImage(authed, "img.png");
    const create = (await (
      await app.request(
        "/api/shares",
        {
          method: "POST",
          headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ resourceType: "image", resourceId: imageId }),
        },
        authed.env,
      )
    ).json()) as { share: { token: string } };
    // Revoke it.
    await app.request(
      `/api/shares/${create.share.token}`,
      { method: "DELETE", headers: { Cookie: authed.cookie } },
      authed.env,
    );
    const res = await app.request(
      "/api/shares",
      { headers: { Cookie: authed.cookie } },
      authed.env,
    );
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(0);
  });
});

// ─── GET /api/shares/:token (public) ────────────────────────────

describe("GET /api/shares/:token — public", () => {
  it("returns minimal metadata without auth", async () => {
    const authed = await setupAuthed();
    const imageId = await uploadImage(authed, "public.png");
    const create = (await (
      await app.request(
        "/api/shares",
        {
          method: "POST",
          headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ resourceType: "image", resourceId: imageId }),
        },
        authed.env,
      )
    ).json()) as { share: { token: string } };

    // NO cookie passed — anonymous request.
    const res = await app.request(`/api/shares/${create.share.token}`, {}, authed.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      share: {
        token: string;
        resourceType: string;
        createdAt: number;
        // Owner-only fields should be absent.
        workspaceId?: string;
        createdByUserId?: string;
      };
    };
    expect(body.share.token).toBe(create.share.token);
    expect(body.share.resourceType).toBe("image");
    // Public wire shape strips owner identifiers.
    expect(body.share.workspaceId).toBeUndefined();
    expect(body.share.createdByUserId).toBeUndefined();
  });

  it("returns 404 for unknown token", async () => {
    const authed = await setupAuthed();
    const res = await app.request("/api/shares/nonexistent", {}, authed.env);
    expect(res.status).toBe(404);
  });

  it("returns 404 for revoked token", async () => {
    const authed = await setupAuthed();
    const imageId = await uploadImage(authed, "img.png");
    const create = (await (
      await app.request(
        "/api/shares",
        {
          method: "POST",
          headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ resourceType: "image", resourceId: imageId }),
        },
        authed.env,
      )
    ).json()) as { share: { token: string } };
    await app.request(
      `/api/shares/${create.share.token}`,
      { method: "DELETE", headers: { Cookie: authed.cookie } },
      authed.env,
    );
    const res = await app.request(`/api/shares/${create.share.token}`, {}, authed.env);
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/shares/:token/payload (public) ────────────────────

describe("GET /api/shares/:token/payload — public", () => {
  it("streams image bytes with the right content-type", async () => {
    const authed = await setupAuthed();
    const imageId = await uploadImage(authed, "img.png");
    const create = (await (
      await app.request(
        "/api/shares",
        {
          method: "POST",
          headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ resourceType: "image", resourceId: imageId }),
        },
        authed.env,
      )
    ).json()) as { share: { token: string } };

    const res = await app.request(`/api/shares/${create.share.token}/payload`, {}, authed.env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toMatch(/public/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(TINY_PNG.length);
  });

  it("streams document bytes with text/html content-type", async () => {
    const authed = await setupAuthed();
    const docId = await uploadDocument(authed, "doc.annot.html");
    const create = (await (
      await app.request(
        "/api/shares",
        {
          method: "POST",
          headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ resourceType: "document", resourceId: docId }),
        },
        authed.env,
      )
    ).json()) as { share: { token: string } };

    const res = await app.request(`/api/shares/${create.share.token}/payload`, {}, authed.env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(DOC_HTML);
  });

  it("increments view_count on each fetch", async () => {
    const authed = await setupAuthed();
    const imageId = await uploadImage(authed, "tick.png");
    const create = (await (
      await app.request(
        "/api/shares",
        {
          method: "POST",
          headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ resourceType: "image", resourceId: imageId }),
        },
        authed.env,
      )
    ).json()) as { share: { token: string } };

    for (let i = 0; i < 3; i++) {
      await app.request(`/api/shares/${create.share.token}/payload`, {}, authed.env);
    }
    // Read the row directly to assert the counter.
    const row = await authed.env.DB.prepare("SELECT view_count FROM share_links WHERE id = ?")
      .bind(create.share.token)
      .first<{ view_count: number }>();
    expect(row?.view_count).toBe(3);
  });

  it("returns 404 for revoked token", async () => {
    const authed = await setupAuthed();
    const imageId = await uploadImage(authed, "img.png");
    const create = (await (
      await app.request(
        "/api/shares",
        {
          method: "POST",
          headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ resourceType: "image", resourceId: imageId }),
        },
        authed.env,
      )
    ).json()) as { share: { token: string } };
    await app.request(
      `/api/shares/${create.share.token}`,
      { method: "DELETE", headers: { Cookie: authed.cookie } },
      authed.env,
    );
    const res = await app.request(`/api/shares/${create.share.token}/payload`, {}, authed.env);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the underlying image has been deleted", async () => {
    const authed = await setupAuthed();
    const imageId = await uploadImage(authed, "doomed.png");
    const create = (await (
      await app.request(
        "/api/shares",
        {
          method: "POST",
          headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ resourceType: "image", resourceId: imageId }),
        },
        authed.env,
      )
    ).json()) as { share: { token: string } };
    // Delete the image. Share row still exists but resource is gone.
    await app.request(
      `/api/images/${imageId}`,
      { method: "DELETE", headers: { Cookie: authed.cookie } },
      authed.env,
    );

    const res = await app.request(`/api/shares/${create.share.token}/payload`, {}, authed.env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("resource_gone");
  });
});

// ─── DELETE /api/shares/:token ──────────────────────────────────

describe("DELETE /api/shares/:token", () => {
  it("revokes a share", async () => {
    const authed = await setupAuthed();
    const imageId = await uploadImage(authed, "img.png");
    const create = (await (
      await app.request(
        "/api/shares",
        {
          method: "POST",
          headers: { Cookie: authed.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ resourceType: "image", resourceId: imageId }),
        },
        authed.env,
      )
    ).json()) as { share: { token: string } };

    const res = await app.request(
      `/api/shares/${create.share.token}`,
      { method: "DELETE", headers: { Cookie: authed.cookie } },
      authed.env,
    );
    expect(res.status).toBe(204);

    // Subsequent public lookup is 404.
    const lookup = await app.request(`/api/shares/${create.share.token}`, {}, authed.env);
    expect(lookup.status).toBe(404);
  });

  it("returns 404 for unknown token", async () => {
    const authed = await setupAuthed();
    const res = await app.request(
      "/api/shares/ghost",
      { method: "DELETE", headers: { Cookie: authed.cookie } },
      authed.env,
    );
    expect(res.status).toBe(404);
  });
});
