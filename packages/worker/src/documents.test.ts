// End-to-end tests for `/api/documents/*`. Mirrors the
// `images.test.ts` patterns 1:1 against the SQLite-backed D1
// mock + in-memory R2 + KV.

import { describe, expect, it } from "vitest";
import app from "./index.js";
import { createSession, type SessionRecord } from "./session.js";
import { makeMockD1Sqlite, makeMockEnv, makeMockKv, makeMockR2 } from "./test-helpers.js";
import { findOrCreateUserFromProvider } from "./user-repo.js";

const PROFILE = {
  provider: "github" as const,
  providerUserId: "11111",
  email: null,
  displayName: "Test User",
  avatarUrl: "",
};

interface AuthedEnv {
  env: ReturnType<typeof makeMockEnv>;
  cookie: string;
  userId: string;
  workspaceId: string;
}

async function setupAuthed(): Promise<AuthedEnv> {
  const kv = makeMockKv();
  const db = makeMockD1Sqlite();
  const r2 = makeMockR2();
  const env = makeMockEnv({ SESSIONS: kv, DB: db, OBJECTS: r2 });
  const upserted = await findOrCreateUserFromProvider(db, PROFILE);
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
    userId: upserted.user.id,
    workspaceId: upserted.workspace.id,
  };
}

// Tiny representative `.annot.html` body. Real documents are larger;
// this is just here so payload-presence assertions have something
// non-empty to look at.
const DOC_HTML =
  "<!doctype html><html><head><title>Test</title></head><body><div data-annot-block></div></body></html>";

// ─── Auth gates ─────────────────────────────────────────────────

describe("/api/documents — auth gates", () => {
  it("POST returns 401 with no cookie", async () => {
    const env = makeMockEnv();
    const res = await app.request(
      "/api/documents?path=doc.annot.html",
      {
        method: "POST",
        body: DOC_HTML,
        headers: { "Content-Type": "text/html" },
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("GET list returns 401 with no cookie", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/documents", {}, env);
    expect(res.status).toBe(401);
  });

  it("GET :id returns 401 with no cookie", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/documents/some-id", {}, env);
    expect(res.status).toBe(401);
  });

  it("DELETE :id returns 401 with no cookie", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/documents/some-id", { method: "DELETE" }, env);
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/documents ────────────────────────────────────────

describe("POST /api/documents", () => {
  it("uploads bytes + writes metadata row + writes R2 + returns 201", async () => {
    const { env, cookie, workspaceId, userId } = await setupAuthed();
    const res = await app.request(
      "/api/documents?path=Docs/test.annot.html",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "text/html",
          "X-Annot-Title": "Test Document",
          "X-Annot-Block-Count": "5",
        },
        body: DOC_HTML,
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      document: {
        id: string;
        path: string;
        sizeBytes: number;
        title: string | null;
        blockCount: number | null;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.document.path).toBe("Docs/test.annot.html");
    expect(body.document.sizeBytes).toBe(DOC_HTML.length);
    expect(body.document.title).toBe("Test Document");
    expect(body.document.blockCount).toBe(5);

    // Verify R2 has the bytes at the documents key (not images!)
    const r2Object = await env.OBJECTS.get(
      `${workspaceId}/documents/${body.document.id}/document.html`,
    );
    expect(r2Object).not.toBeNull();
    expect(r2Object?.size).toBe(DOC_HTML.length);

    // Verify D1 has the row.
    const dbRow = await env.DB.prepare("SELECT created_by_user_id FROM documents WHERE id = ?")
      .bind(body.document.id)
      .first<{ created_by_user_id: string }>();
    expect(dbRow?.created_by_user_id).toBe(userId);
  });

  it("returns 400 when path is missing", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/documents",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: DOC_HTML,
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 when path is invalid", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/documents?path=/leading-slash.annot.html",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: DOC_HTML,
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_path");
  });

  it("returns 400 on empty body", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/documents?path=empty.annot.html",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: new Uint8Array(0),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("empty_body");
  });

  it("returns 409 on path conflict", async () => {
    const { env, cookie } = await setupAuthed();
    await app.request(
      "/api/documents?path=dup.annot.html",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: DOC_HTML,
      },
      env,
    );
    const res = await app.request(
      "/api/documents?path=dup.annot.html",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: DOC_HTML,
      },
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; existingDocumentId: string };
    expect(body.error).toBe("path_conflict");
    expect(body.existingDocumentId).toBeTruthy();
  });

  it("returns 413 when Content-Length exceeds the document cap", async () => {
    const { env, cookie } = await setupAuthed();
    // Document cap is 50 MB; 60 MB exceeds it.
    const res = await app.request(
      "/api/documents?path=huge.annot.html",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "text/html",
          "Content-Length": String(60 * 1024 * 1024),
        },
        body: DOC_HTML,
      },
      env,
    );
    expect(res.status).toBe(413);
  });

  it("accepts uploads up to the document cap (above the image cap)", async () => {
    // 30 MB is over the image cap (25) but under the document
    // cap (50). The body itself is tiny — only the header gets
    // checked because the actual bytes fit in memory.
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/documents?path=large.annot.html",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "text/html",
          "Content-Length": String(30 * 1024 * 1024),
        },
        body: DOC_HTML,
      },
      env,
    );
    expect(res.status).toBe(201);
  });

  it("returns 413 quota_exceeded when the workspace is over the storage cap", async () => {
    const { env, cookie, workspaceId } = await setupAuthed();
    // Seed 4.999 GB of "existing" document bytes.
    await env.DB.prepare(
      `INSERT INTO documents (
        id, workspace_id, created_by_user_id, path,
        document_r2_key, size_bytes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "seed-doc",
        workspaceId,
        "fake-user",
        "seed.annot.html",
        `${workspaceId}/documents/seed-doc/document.html`,
        4_999_000_000,
        Date.now(),
        Date.now(),
      )
      .run();

    const big = new Uint8Array(2_000_000); // 2 MB body — pushes over 5 GB.
    const res = await app.request(
      "/api/documents?path=overflow.annot.html",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: big,
      },
      env,
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as {
      error: string;
      exceeded?: string;
      plan?: string;
    };
    expect(body.error).toBe("quota_exceeded");
    expect(body.exceeded).toBe("storage");
    expect(body.plan).toBe("free");
  });

  it("returns 413 quota_exceeded when the workspace is over the document count cap", async () => {
    const { env, cookie, workspaceId } = await setupAuthed();
    // Seed 50 documents — the free cap.
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      await env.DB.prepare(
        `INSERT INTO documents (
          id, workspace_id, created_by_user_id, path,
          document_r2_key, size_bytes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          `seed-doc-${i}`,
          workspaceId,
          "fake-user",
          `seed-${i}.annot.html`,
          `${workspaceId}/documents/seed-doc-${i}/document.html`,
          1000,
          now,
          now,
        )
        .run();
    }

    const res = await app.request(
      "/api/documents?path=overflow.annot.html",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: DOC_HTML,
      },
      env,
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; exceeded?: string };
    expect(body.error).toBe("quota_exceeded");
    expect(body.exceeded).toBe("documents");
  });

  it("rollbacks the D1 row if R2 write fails", async () => {
    const { env, cookie, workspaceId } = await setupAuthed();
    const brokenR2 = {
      put: async () => {
        throw new Error("R2 write failed");
      },
      head: async () => null,
      get: async () => null,
      delete: async () => {},
      list: async () => ({ objects: [], truncated: false }),
    } as unknown as R2Bucket;
    const brokenEnv = { ...env, OBJECTS: brokenR2 };
    const res = await app.request(
      "/api/documents?path=fails.annot.html",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: DOC_HTML,
      },
      brokenEnv,
    );
    expect(res.status).toBe(500);

    const list = await env.DB.prepare(
      "SELECT id FROM documents WHERE workspace_id = ? AND deleted_at IS NULL",
    )
      .bind(workspaceId)
      .all<{ id: string }>();
    expect(list.results.length).toBe(0);
  });
});

// ─── GET /api/documents (list) ──────────────────────────────────

describe("GET /api/documents", () => {
  it("returns the workspace's documents, newest-first", async () => {
    const { env, cookie } = await setupAuthed();
    for (const name of ["a.annot.html", "b.annot.html", "c.annot.html"]) {
      await app.request(
        `/api/documents?path=${name}`,
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        env,
      );
      await new Promise((r) => setTimeout(r, 2));
    }
    const res = await app.request("/api/documents", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as {
      ok: boolean;
      documents: { path: string }[];
      count: number;
    };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(3);
    expect(body.documents.map((d) => d.path)).toEqual([
      "c.annot.html",
      "b.annot.html",
      "a.annot.html",
    ]);
  });

  it("honours folder= prefix filter", async () => {
    const { env, cookie } = await setupAuthed();
    for (const path of ["guides/x.annot.html", "guides/y.annot.html", "notes/z.annot.html"]) {
      await app.request(
        `/api/documents?path=${path}`,
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        env,
      );
    }
    const res = await app.request(
      "/api/documents?folder=guides/",
      { headers: { Cookie: cookie } },
      env,
    );
    const body = (await res.json()) as {
      documents: { path: string }[];
    };
    expect(body.documents.map((d) => d.path).sort()).toEqual([
      "guides/x.annot.html",
      "guides/y.annot.html",
    ]);
  });
});

// ─── GET /api/documents/:id ─────────────────────────────────────

describe("GET /api/documents/:id", () => {
  it("returns metadata for an existing document", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/documents?path=x.annot.html",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        env,
      )
    ).json()) as { document: { id: string } };

    const res = await app.request(
      `/api/documents/${create.document.id}`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: { id: string; path: string } };
    expect(body.document.id).toBe(create.document.id);
    expect(body.document.path).toBe("x.annot.html");
  });

  it("returns 404 for unknown id", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/documents/nonexistent",
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/documents/:id ───────────────────────────────────

describe("PATCH /api/documents/:id", () => {
  it("patches metadata fields", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/documents?path=x.annot.html",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        env,
      )
    ).json()) as { document: { id: string } };

    const res = await app.request(
      `/api/documents/${create.document.id}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed", blockCount: 10 }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      document: { title: string | null; blockCount: number | null };
    };
    expect(body.document.title).toBe("Renamed");
    expect(body.document.blockCount).toBe(10);
  });

  it("supports renaming via path field", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/documents?path=old.annot.html",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        env,
      )
    ).json()) as { document: { id: string } };

    const res = await app.request(
      `/api/documents/${create.document.id}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "new.annot.html" }),
      },
      env,
    );
    const body = (await res.json()) as { document: { path: string } };
    expect(body.document.path).toBe("new.annot.html");
  });

  it("returns 409 when renaming onto an existing path", async () => {
    const { env, cookie } = await setupAuthed();
    const r1 = (await (
      await app.request(
        "/api/documents?path=a.annot.html",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        env,
      )
    ).json()) as { document: { id: string } };
    await app.request(
      "/api/documents?path=b.annot.html",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: DOC_HTML,
      },
      env,
    );
    const res = await app.request(
      `/api/documents/${r1.document.id}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "b.annot.html" }),
      },
      env,
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 for unknown id", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/documents/ghost",
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for non-JSON body", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/documents?path=x.annot.html",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        env,
      )
    ).json()) as { document: { id: string } };
    const res = await app.request(
      `/api/documents/${create.document.id}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: "not json",
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/documents/:id ──────────────────────────────────

describe("DELETE /api/documents/:id", () => {
  it("soft-deletes the row AND removes R2 bytes", async () => {
    const { env, cookie, workspaceId } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/documents?path=x.annot.html",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        env,
      )
    ).json()) as { document: { id: string } };

    const r2Key = `${workspaceId}/documents/${create.document.id}/document.html`;
    expect(await env.OBJECTS.head(r2Key)).not.toBeNull();

    const res = await app.request(
      `/api/documents/${create.document.id}`,
      { method: "DELETE", headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(204);

    expect(await env.OBJECTS.head(r2Key)).toBeNull();

    const getRes = await app.request(
      `/api/documents/${create.document.id}`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(getRes.status).toBe(404);

    // The path is freed up for re-upload.
    const reupload = await app.request(
      "/api/documents?path=x.annot.html",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: DOC_HTML,
      },
      env,
    );
    expect(reupload.status).toBe(201);
  });

  it("returns 404 for unknown id", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/documents/ghost",
      { method: "DELETE", headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/documents/:id/content ─────────────────────────────

describe("GET /api/documents/:id/content", () => {
  it("streams the bytes with text/html Content-Type", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/documents?path=x.annot.html",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        env,
      )
    ).json()) as { document: { id: string } };
    const res = await app.request(
      `/api/documents/${create.document.id}/content`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(DOC_HTML);
  });

  it("returns 404 for unknown id", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/documents/ghost/content",
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/documents/:id/content ───────────────────────────

describe("PATCH /api/documents/:id/content", () => {
  it("overwrites the document bytes + updates sizeBytes", async () => {
    const { env, cookie, workspaceId } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/documents?path=x.annot.html",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        env,
      )
    ).json()) as { document: { id: string; sizeBytes: number } };

    const updated = `${DOC_HTML}<div data-annot-block id="new"></div>`;
    const res = await app.request(
      `/api/documents/${create.document.id}/content`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: updated,
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      document: { sizeBytes: number };
    };
    expect(body.document.sizeBytes).toBe(updated.length);

    // R2 bytes match.
    const r2Key = `${workspaceId}/documents/${create.document.id}/document.html`;
    const obj = await env.OBJECTS.get(r2Key);
    expect(await obj?.text()).toBe(updated);
  });

  it("updates title / blockCount from headers when present", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/documents?path=x.annot.html",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        env,
      )
    ).json()) as { document: { id: string } };

    const res = await app.request(
      `/api/documents/${create.document.id}/content`,
      {
        method: "PATCH",
        headers: {
          Cookie: cookie,
          "Content-Type": "text/html",
          "X-Annot-Title": "Updated Title",
          "X-Annot-Block-Count": "42",
        },
        body: DOC_HTML,
      },
      env,
    );
    const body = (await res.json()) as {
      document: { title: string | null; blockCount: number | null };
    };
    expect(body.document.title).toBe("Updated Title");
    expect(body.document.blockCount).toBe(42);
  });

  it("returns 404 for unknown id", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/documents/ghost/content",
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: DOC_HTML,
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 on empty body", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/documents?path=x.annot.html",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        env,
      )
    ).json()) as { document: { id: string } };

    const res = await app.request(
      `/api/documents/${create.document.id}/content`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "text/html" },
        body: new Uint8Array(0),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("empty_body");
  });
});

// ─── Cross-workspace isolation ──────────────────────────────────

describe("cross-workspace isolation", () => {
  it("document uploaded in workspace A is invisible from workspace B's session", async () => {
    const a = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/documents?path=secret.annot.html",
        {
          method: "POST",
          headers: { Cookie: a.cookie, "Content-Type": "text/html" },
          body: DOC_HTML,
        },
        a.env,
      )
    ).json()) as { document: { id: string } };

    const otherProfile = { ...PROFILE, providerUserId: "22222" };
    const otherUpserted = await findOrCreateUserFromProvider(a.env.DB, otherProfile);
    const otherSession: SessionRecord = {
      provider: "github",
      providerUserId: "22222",
      login: "other-user",
      name: "Other",
      avatarUrl: "",
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      userId: otherUpserted.user.id,
      workspaceId: otherUpserted.workspace.id,
    };
    const otherToken = await createSession(a.env.SESSIONS, otherSession);
    const otherCookie = `annot_session=${otherToken}`;

    const res = await app.request(
      `/api/documents/${create.document.id}`,
      { headers: { Cookie: otherCookie } },
      a.env,
    );
    expect(res.status).toBe(404);

    const listRes = await app.request(
      "/api/documents",
      { headers: { Cookie: otherCookie } },
      a.env,
    );
    const listBody = (await listRes.json()) as { count: number };
    expect(listBody.count).toBe(0);
  });
});
