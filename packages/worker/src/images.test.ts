// End-to-end tests for `/api/images/*`. Uses the SQLite-backed
// D1 mock (`makeMockD1Sqlite`) + in-memory R2 mock so the tests
// run the same SQL the production binding runs.

import { describe, expect, it } from "vitest";
import app from "./index.js";
import { createSession, type SessionRecord } from "./session.js";
import { makeMockD1Sqlite, makeMockEnv, makeMockKv, makeMockR2 } from "./test-helpers.js";
import { findOrCreateUserFromProvider } from "./user-repo.js";

const PROFILE = {
  provider: "github" as const,
  providerUserId: "12345",
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

/** Spin up a full-stack test environment: SQLite D1 + KV + R2
 *  + an authenticated session cookie. The returned `env` is
 *  passed to `app.request(...)`; the `cookie` goes into
 *  request headers. */
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

// Tiny PNG bytes for upload tests. Avoids generating real bitmaps
// per test; payload contents don't matter — R2 mock stores opaque.
const TINY_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ─── Auth gates ─────────────────────────────────────────────────

describe("/api/images — auth gates", () => {
  it("POST returns 401 with no cookie", async () => {
    const env = makeMockEnv();
    const res = await app.request(
      "/api/images?path=x.png",
      {
        method: "POST",
        body: TINY_PNG_BYTES,
        headers: { "Content-Type": "image/png" },
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("GET list returns 401 with no cookie", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/images", {}, env);
    expect(res.status).toBe(401);
  });

  it("GET :id returns 401 with no cookie", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/images/some-id", {}, env);
    expect(res.status).toBe(401);
  });

  it("DELETE :id returns 401 with no cookie", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/images/some-id", { method: "DELETE" }, env);
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/images ───────────────────────────────────────────

describe("POST /api/images", () => {
  it("uploads bytes + writes metadata row + writes R2 + returns 201", async () => {
    const { env, cookie, workspaceId, userId } = await setupAuthed();
    const res = await app.request(
      "/api/images?path=Screenshots/test.png",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "image/png",
          "X-Annot-Width": "1280",
          "X-Annot-Height": "720",
        },
        body: TINY_PNG_BYTES,
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      image: {
        id: string;
        path: string;
        sizeBytes: number;
        width: number | null;
        height: number | null;
        mimeType: string | null;
        hasAnnotations: boolean;
        hasThumbnail: boolean;
        tags: Record<string, string>;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.image.path).toBe("Screenshots/test.png");
    expect(body.image.sizeBytes).toBe(TINY_PNG_BYTES.byteLength);
    expect(body.image.width).toBe(1280);
    expect(body.image.height).toBe(720);
    expect(body.image.mimeType).toBe("image/png");
    expect(body.image.hasAnnotations).toBe(false);
    expect(body.image.hasThumbnail).toBe(false);
    expect(body.image.tags).toEqual({});

    // Verify R2 has the bytes.
    const r2Object = await env.OBJECTS.get(`${workspaceId}/images/${body.image.id}/original`);
    expect(r2Object).not.toBeNull();
    expect(r2Object?.size).toBe(TINY_PNG_BYTES.byteLength);

    // Verify D1 has the row.
    const dbRow = await env.DB.prepare("SELECT created_by_user_id FROM images WHERE id = ?")
      .bind(body.image.id)
      .first<{ created_by_user_id: string }>();
    expect(dbRow?.created_by_user_id).toBe(userId);
  });

  it("returns 400 when path is missing", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/images",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "image/png" },
        body: TINY_PNG_BYTES,
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
      "/api/images?path=/leading-slash.png",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "image/png" },
        body: TINY_PNG_BYTES,
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
      "/api/images?path=empty.png",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "image/png" },
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
    // First upload — succeeds.
    await app.request(
      "/api/images?path=dup.png",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "image/png" },
        body: TINY_PNG_BYTES,
      },
      env,
    );
    // Second upload at the same path — 409.
    const res = await app.request(
      "/api/images?path=dup.png",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "image/png" },
        body: TINY_PNG_BYTES,
      },
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      existingImageId: string;
    };
    expect(body.error).toBe("path_conflict");
    expect(body.existingImageId).toBeTruthy();
  });

  it("returns 413 when Content-Length exceeds the cap", async () => {
    const { env, cookie } = await setupAuthed();
    // The 50 MB advertised here won't actually be transferred —
    // the gate fires before the body is consumed.
    const res = await app.request(
      "/api/images?path=huge.png",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "image/png",
          "Content-Length": String(50 * 1024 * 1024),
        },
        body: TINY_PNG_BYTES,
      },
      env,
    );
    expect(res.status).toBe(413);
  });

  it("returns 413 quota_exceeded when the workspace is over the storage cap", async () => {
    const { env, cookie, workspaceId } = await setupAuthed();
    // Seed 4.999 GB of "existing" image bytes — just under the
    // 5 GB free cap. Insert directly via D1 since we only need
    // the size_bytes column; no R2 bytes are required for the
    // quota math.
    await env.DB.prepare(
      `INSERT INTO images (
        id, workspace_id, created_by_user_id, path,
        original_r2_key, size_bytes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "seed-id",
        workspaceId,
        "fake-user",
        "seed.png",
        `${workspaceId}/images/seed-id/original`,
        4_999_000_000,
        Date.now(),
        Date.now(),
      )
      .run();

    // Now attempt to upload a small image. The bytes themselves
    // are tiny but the quota check projects current + additional
    // against the 5 GB cap and rejects.
    const big = new Uint8Array(2_000_000); // 2 MB body — pushes 4.999 + 0.002 GB > 5 GB
    const res = await app.request(
      "/api/images?path=overflow.png",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "image/png" },
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

  it("rollbacks the D1 row if R2 write fails", async () => {
    const { env, cookie, workspaceId } = await setupAuthed();
    // Replace OBJECTS with a broken one. Keep the same `db` /
    // `r2` references so we can verify after.
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
      "/api/images?path=fails.png",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "image/png" },
        body: TINY_PNG_BYTES,
      },
      brokenEnv,
    );
    expect(res.status).toBe(500);

    // The D1 row should be soft-deleted (not visible from listImages).
    const list = await env.DB.prepare(
      "SELECT id FROM images WHERE workspace_id = ? AND deleted_at IS NULL",
    )
      .bind(workspaceId)
      .all<{ id: string }>();
    expect(list.results.length).toBe(0);
  });
});

// ─── GET /api/images (list) ─────────────────────────────────────

describe("GET /api/images", () => {
  it("returns the workspace's images, newest-first", async () => {
    const { env, cookie } = await setupAuthed();
    for (const name of ["a.png", "b.png", "c.png"]) {
      await app.request(
        `/api/images?path=${name}`,
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      );
      await new Promise((r) => setTimeout(r, 2));
    }
    const res = await app.request("/api/images", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as {
      ok: boolean;
      images: { path: string }[];
      count: number;
    };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(3);
    expect(body.images.map((i) => i.path)).toEqual(["c.png", "b.png", "a.png"]);
  });

  it("honours folder= prefix filter", async () => {
    const { env, cookie } = await setupAuthed();
    for (const path of ["folder/x.png", "folder/y.png", "other/z.png"]) {
      await app.request(
        `/api/images?path=${path}`,
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      );
    }
    const res = await app.request(
      "/api/images?folder=folder/",
      { headers: { Cookie: cookie } },
      env,
    );
    const body = (await res.json()) as {
      images: { path: string }[];
    };
    expect(body.images.map((i) => i.path).sort()).toEqual(["folder/x.png", "folder/y.png"]);
  });

  it("honours limit + offset", async () => {
    const { env, cookie } = await setupAuthed();
    for (let i = 0; i < 5; i++) {
      await app.request(
        `/api/images?path=img-${i}.png`,
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      );
      await new Promise((r) => setTimeout(r, 1));
    }
    const page1 = (await (
      await app.request("/api/images?limit=2&offset=0", { headers: { Cookie: cookie } }, env)
    ).json()) as { images: { id: string }[] };
    const page2 = (await (
      await app.request("/api/images?limit=2&offset=2", { headers: { Cookie: cookie } }, env)
    ).json()) as { images: { id: string }[] };
    expect(page1.images.length).toBe(2);
    expect(page2.images.length).toBe(2);
    expect(page1.images[0]?.id).not.toBe(page2.images[0]?.id);
  });
});

// ─── GET /api/images/:id ────────────────────────────────────────

describe("GET /api/images/:id", () => {
  it("returns metadata for an existing image", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/images?path=x.png",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      )
    ).json()) as { image: { id: string } };

    const res = await app.request(
      `/api/images/${create.image.id}`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { image: { id: string; path: string } };
    expect(body.image.id).toBe(create.image.id);
    expect(body.image.path).toBe("x.png");
  });

  it("returns 404 for unknown id", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request("/api/images/nonexistent", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/images/:id ──────────────────────────────────────

describe("PATCH /api/images/:id", () => {
  it("patches metadata fields", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/images?path=x.png",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      )
    ).json()) as { image: { id: string } };

    const res = await app.request(
      `/api/images/${create.image.id}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          width: 1024,
          height: 768,
          tags: { reviewed: "true" },
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      image: {
        width: number;
        height: number;
        tags: Record<string, string>;
      };
    };
    expect(body.image.width).toBe(1024);
    expect(body.image.height).toBe(768);
    expect(body.image.tags).toEqual({ reviewed: "true" });
  });

  it("supports renaming via path field", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/images?path=old.png",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      )
    ).json()) as { image: { id: string } };

    const res = await app.request(
      `/api/images/${create.image.id}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "new.png" }),
      },
      env,
    );
    const body = (await res.json()) as { image: { path: string } };
    expect(body.image.path).toBe("new.png");
  });

  it("returns 409 when renaming onto an existing path", async () => {
    const { env, cookie } = await setupAuthed();
    // Create two images at different paths.
    const r1 = (await (
      await app.request(
        "/api/images?path=a.png",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      )
    ).json()) as { image: { id: string } };
    await app.request(
      "/api/images?path=b.png",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "image/png" },
        body: TINY_PNG_BYTES,
      },
      env,
    );
    // Try to rename a.png → b.png.
    const res = await app.request(
      `/api/images/${r1.image.id}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "b.png" }),
      },
      env,
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 for unknown id", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/images/ghost",
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ width: 100 }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for non-JSON body", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/images?path=x.png",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      )
    ).json()) as { image: { id: string } };
    const res = await app.request(
      `/api/images/${create.image.id}`,
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

// ─── DELETE /api/images/:id ─────────────────────────────────────

describe("DELETE /api/images/:id", () => {
  it("soft-deletes the row AND removes R2 bytes", async () => {
    const { env, cookie, workspaceId } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/images?path=x.png",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      )
    ).json()) as { image: { id: string } };

    const r2Key = `${workspaceId}/images/${create.image.id}/original`;
    expect(await env.OBJECTS.head(r2Key)).not.toBeNull();

    const res = await app.request(
      `/api/images/${create.image.id}`,
      { method: "DELETE", headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(204);

    // R2 bytes gone.
    expect(await env.OBJECTS.head(r2Key)).toBeNull();

    // D1 row soft-deleted (not visible via GET).
    const getRes = await app.request(
      `/api/images/${create.image.id}`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(getRes.status).toBe(404);

    // The path is freed up for re-upload.
    const reupload = await app.request(
      "/api/images?path=x.png",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "image/png" },
        body: TINY_PNG_BYTES,
      },
      env,
    );
    expect(reupload.status).toBe(201);
  });

  it("returns 404 for unknown id", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/images/ghost",
      { method: "DELETE", headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/images/:id/original ───────────────────────────────

describe("GET /api/images/:id/original", () => {
  it("streams the bytes with the stored Content-Type", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/images?path=x.png",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      )
    ).json()) as { image: { id: string } };
    const res = await app.request(
      `/api/images/${create.image.id}/original`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(TINY_PNG_BYTES.length);
    expect(bytes[0]).toBe(0x89);
  });

  it("returns 404 for unknown id", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/images/ghost/original",
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ─── PATCH + GET /api/images/:id/annotations ────────────────────

describe("annotations round-trip", () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

  it("PATCH writes SVG to R2 + flips hasAnnotations", async () => {
    const { env, cookie, workspaceId } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/images?path=x.png",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      )
    ).json()) as { image: { id: string; hasAnnotations: boolean } };
    expect(create.image.hasAnnotations).toBe(false);

    const res = await app.request(
      `/api/images/${create.image.id}/annotations`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "image/svg+xml" },
        body: SVG,
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      image: { hasAnnotations: boolean };
    };
    expect(body.image.hasAnnotations).toBe(true);

    // Verify R2 has the bytes at the expected key.
    const r2Key = `${workspaceId}/images/${create.image.id}/annotations.svg`;
    const obj = await env.OBJECTS.get(r2Key);
    expect(obj).not.toBeNull();
    expect(await obj?.text()).toBe(SVG);
  });

  it("GET returns the SVG with image/svg+xml Content-Type", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/images?path=x.png",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      )
    ).json()) as { image: { id: string } };
    await app.request(
      `/api/images/${create.image.id}/annotations`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "image/svg+xml" },
        body: SVG,
      },
      env,
    );
    const res = await app.request(
      `/api/images/${create.image.id}/annotations`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await res.text()).toBe(SVG);
  });

  it("GET returns 404 no_annotations before any PATCH", async () => {
    const { env, cookie } = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/images?path=x.png",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      )
    ).json()) as { image: { id: string } };
    const res = await app.request(
      `/api/images/${create.image.id}/annotations`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_annotations");
  });

  it("PATCH returns 404 for unknown image id", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/images/ghost/annotations",
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "image/svg+xml" },
        body: SVG,
      },
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ─── PATCH + GET /api/images/:id/annotations-yaml ───────────────

describe("annotations-yaml round-trip", () => {
  const YAML = "version: 1\noverlays:\n  - ref: e2\n    intent: primary\n";

  async function createImage(env: AuthedEnv["env"], cookie: string): Promise<string> {
    const create = (await (
      await app.request(
        "/api/images?path=y.png",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        env,
      )
    ).json()) as { image: { id: string } };
    return create.image.id;
  }

  it("GET returns 404 no_annotations_yaml before any PATCH", async () => {
    const { env, cookie } = await setupAuthed();
    const id = await createImage(env, cookie);
    const res = await app.request(
      `/api/images/${id}/annotations-yaml`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_annotations_yaml");
  });

  it("PATCH writes yaml to R2, GET returns it with text/yaml", async () => {
    const { env, cookie, workspaceId } = await setupAuthed();
    const id = await createImage(env, cookie);

    const patch = await app.request(
      `/api/images/${id}/annotations-yaml`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "text/yaml" },
        body: YAML,
      },
      env,
    );
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { ok: boolean }).ok).toBe(true);

    // Bytes land at the deterministic key beside annotations.svg.
    const key = `${workspaceId}/images/${id}/annotations.yaml`;
    const obj = await env.OBJECTS.get(key);
    expect(obj).not.toBeNull();
    expect(await obj?.text()).toBe(YAML);

    const get = await app.request(
      `/api/images/${id}/annotations-yaml`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Type")).toBe("text/yaml; charset=utf-8");
    expect(await get.text()).toBe(YAML);
  });

  it("PATCH replaces existing yaml (create-or-replace)", async () => {
    const { env, cookie } = await setupAuthed();
    const id = await createImage(env, cookie);
    for (const body of [YAML, "version: 1\noverlays: []\n"]) {
      await app.request(
        `/api/images/${id}/annotations-yaml`,
        { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "text/yaml" }, body },
        env,
      );
    }
    const get = await app.request(
      `/api/images/${id}/annotations-yaml`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(await get.text()).toBe("version: 1\noverlays: []\n");
  });

  it("PATCH returns 404 for an unknown image id", async () => {
    const { env, cookie } = await setupAuthed();
    const res = await app.request(
      "/api/images/ghost/annotations-yaml",
      { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "text/yaml" }, body: YAML },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("DELETE image cleans up the yaml sidecar from R2", async () => {
    const { env, cookie, workspaceId } = await setupAuthed();
    const id = await createImage(env, cookie);
    await app.request(
      `/api/images/${id}/annotations-yaml`,
      { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "text/yaml" }, body: YAML },
      env,
    );
    const key = `${workspaceId}/images/${id}/annotations.yaml`;
    expect(await env.OBJECTS.get(key)).not.toBeNull();

    const del = await app.request(
      `/api/images/${id}`,
      { method: "DELETE", headers: { Cookie: cookie } },
      env,
    );
    expect(del.status).toBe(204);
    expect(await env.OBJECTS.get(key)).toBeNull();
  });

  it("GET is workspace-scoped: another workspace cannot read the sidecar", async () => {
    const a = await setupAuthed();
    const id = await createImage(a.env, a.cookie);
    await app.request(
      `/api/images/${id}/annotations-yaml`,
      { method: "PATCH", headers: { Cookie: a.cookie, "Content-Type": "text/yaml" }, body: YAML },
      a.env,
    );

    // Second workspace + session sharing the SAME D1 / KV / R2, so
    // this mirrors single-deploy reality (cf. the cross-workspace
    // isolation block below).
    const otherUpserted = await findOrCreateUserFromProvider(a.env.DB, {
      ...PROFILE,
      providerUserId: "88888",
    });
    const otherToken = await createSession(a.env.SESSIONS, {
      provider: "github",
      providerUserId: "88888",
      login: "other-user",
      name: "Other",
      avatarUrl: "",
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      userId: otherUpserted.user.id,
      workspaceId: otherUpserted.workspace.id,
    });

    // Other workspace's session + A's image id → not_found (the
    // findImageById lookup is scoped to the caller's workspace).
    const res = await app.request(
      `/api/images/${id}/annotations-yaml`,
      { headers: { Cookie: `annot_session=${otherToken}` } },
      a.env,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});

// ─── Cross-workspace isolation ──────────────────────────────────

describe("cross-workspace isolation", () => {
  it("image uploaded in workspace A is invisible from workspace B's session", async () => {
    const a = await setupAuthed();
    const create = (await (
      await app.request(
        "/api/images?path=secret.png",
        {
          method: "POST",
          headers: { Cookie: a.cookie, "Content-Type": "image/png" },
          body: TINY_PNG_BYTES,
        },
        a.env,
      )
    ).json()) as { image: { id: string } };

    // Create a SECOND workspace + session by repeating the OAuth
    // upsert with a different provider id. Crucial: share the
    // same D1 / KV / R2 so the test mirrors single-deploy reality.
    const otherProfile = { ...PROFILE, providerUserId: "99999" };
    const otherUpserted = await findOrCreateUserFromProvider(a.env.DB, otherProfile);
    const otherSession: SessionRecord = {
      provider: "github",
      providerUserId: "99999",
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

    // Other user GET on workspace A's image id → 404 (not 200).
    const res = await app.request(
      `/api/images/${create.image.id}`,
      { headers: { Cookie: otherCookie } },
      a.env,
    );
    expect(res.status).toBe(404);

    // Other user's list is empty (no images in their workspace).
    const listRes = await app.request("/api/images", { headers: { Cookie: otherCookie } }, a.env);
    const listBody = (await listRes.json()) as { count: number };
    expect(listBody.count).toBe(0);
  });
});
