// Tests for `storage-repo.ts` against the SQLite-backed D1 mock
// (loads `0001_auth.sql` + `0002_storage.sql` real migrations).

import { beforeEach, describe, expect, it } from "vitest";
import {
  type AuditEventRow,
  findDocumentById,
  findDocumentByPath,
  findImageById,
  findImageByPath,
  insertDocument,
  insertImage,
  listDocuments,
  listImages,
  recordAuditEvent,
  softDeleteDocument,
  softDeleteImage,
  totalStorageUsedBytes,
  updateDocument,
  updateImage,
} from "./storage-repo.js";
import { makeMockD1Sqlite } from "./test-helpers.js";
import { findOrCreateUserFromProvider } from "./user-repo.js";

const PROFILE = {
  provider: "github" as const,
  providerUserId: "12345",
  email: null,
  displayName: "Test User",
  avatarUrl: "",
};

// Helper: spin up a SQLite D1 with auth schema applied and a
// user + personal workspace seeded. Returns the IDs.
async function setupWorkspace() {
  const db = makeMockD1Sqlite();
  const { user, workspace } = await findOrCreateUserFromProvider(db, PROFILE);
  return { db, userId: user.id, workspaceId: workspace.id };
}

// ─── images ─────────────────────────────────────────────────────

describe("insertImage + findImageById", () => {
  it("inserts an image row with required fields populated", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const row = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "Screenshots/test.png",
      sizeBytes: 12345,
      width: 1280,
      height: 720,
      mimeType: "image/png",
    });
    expect(row.id).toBeTruthy();
    expect(row.workspace_id).toBe(workspaceId);
    expect(row.created_by_user_id).toBe(userId);
    expect(row.path).toBe("Screenshots/test.png");
    expect(row.size_bytes).toBe(12345);
    expect(row.width).toBe(1280);
    expect(row.height).toBe(720);
    expect(row.mime_type).toBe("image/png");
    expect(row.annotations_r2_key).toBeNull();
    expect(row.thumbnail_r2_key).toBeNull();
    expect(row.deleted_at).toBeNull();
    // R2 key derives from id + workspaceId.
    expect(row.original_r2_key).toBe(`${workspaceId}/images/${row.id}/original`);
    // Timestamps populated.
    expect(typeof row.created_at).toBe("number");
    expect(row.created_at).toBe(row.updated_at);
  });

  it("encodes tags as JSON in tags_json", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const row = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "a.png",
      sizeBytes: 100,
      tags: { project: "annot", priority: "high" },
    });
    expect(JSON.parse(row.tags_json ?? "{}")).toEqual({
      project: "annot",
      priority: "high",
    });
  });

  it("findImageById returns the matching row", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const inserted = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.png",
      sizeBytes: 1,
    });
    const found = await findImageById(db, workspaceId, inserted.id);
    expect(found?.id).toBe(inserted.id);
  });

  it("findImageById is scoped by workspace (no cross-tenant leak)", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const inserted = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.png",
      sizeBytes: 1,
    });
    // Look up the image under a different workspace id → null.
    const found = await findImageById(db, "other-workspace", inserted.id);
    expect(found).toBeNull();
  });

  it("findImageById returns null for soft-deleted rows", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const inserted = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.png",
      sizeBytes: 1,
    });
    await softDeleteImage(db, workspaceId, inserted.id);
    expect(await findImageById(db, workspaceId, inserted.id)).toBeNull();
  });
});

describe("findImageByPath + path uniqueness", () => {
  it("returns the row matching workspace + path", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "folder/x.png",
      sizeBytes: 1,
    });
    const found = await findImageByPath(db, workspaceId, "folder/x.png");
    expect(found?.path).toBe("folder/x.png");
  });

  it("rejects a second image at the same path within a workspace", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "dup.png",
      sizeBytes: 1,
    });
    await expect(
      insertImage(db, {
        workspaceId,
        createdByUserId: userId,
        path: "dup.png",
        sizeBytes: 2,
      }),
    ).rejects.toThrow();
  });

  it("allows the same path in DIFFERENT workspaces", async () => {
    const ws1 = await setupWorkspace();
    const ws2 = await setupWorkspace();
    await insertImage(ws1.db, {
      workspaceId: ws1.workspaceId,
      createdByUserId: ws1.userId,
      path: "shared.png",
      sizeBytes: 1,
    });
    // Different workspace, same path — fine. (Different DBs here
    // since each setupWorkspace makes a fresh sqlite, but the
    // UNIQUE is scoped to (workspace, path) anyway.)
    await expect(
      insertImage(ws2.db, {
        workspaceId: ws2.workspaceId,
        createdByUserId: ws2.userId,
        path: "shared.png",
        sizeBytes: 2,
      }),
    ).resolves.toBeTruthy();
  });

  it("frees up the path after soft-delete (can re-upload)", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const first = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.png",
      sizeBytes: 1,
    });
    await softDeleteImage(db, workspaceId, first.id);
    const second = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.png",
      sizeBytes: 2,
    });
    expect(second.id).not.toBe(first.id);
  });
});

describe("updateImage", () => {
  it("patches the provided fields and bumps updated_at", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const inserted = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.png",
      sizeBytes: 100,
    });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateImage(db, workspaceId, inserted.id, {
      annotationsR2Key: `${workspaceId}/images/${inserted.id}/annotations.svg`,
      sizeBytes: 200,
      tags: { reviewed: "true" },
    });
    expect(updated?.annotations_r2_key).toBe(
      `${workspaceId}/images/${inserted.id}/annotations.svg`,
    );
    expect(updated?.size_bytes).toBe(200);
    expect(JSON.parse(updated?.tags_json ?? "{}")).toEqual({
      reviewed: "true",
    });
    expect(updated?.updated_at).toBeGreaterThan(inserted.updated_at);
    expect(updated?.created_at).toBe(inserted.created_at);
  });

  it("returns null when the image doesn't exist", async () => {
    const { db, workspaceId } = await setupWorkspace();
    expect(await updateImage(db, workspaceId, "nonexistent", { sizeBytes: 1 })).toBeNull();
  });

  it("no-op update returns the unchanged row", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const inserted = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.png",
      sizeBytes: 1,
    });
    const same = await updateImage(db, workspaceId, inserted.id, {});
    expect(same?.id).toBe(inserted.id);
    expect(same?.size_bytes).toBe(1);
  });

  it("nulling a field explicitly works", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const inserted = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.png",
      sizeBytes: 1,
      sourceUrl: "https://example.com",
    });
    expect(inserted.source_url).toBe("https://example.com");
    const updated = await updateImage(db, workspaceId, inserted.id, {
      sourceUrl: null,
    });
    expect(updated?.source_url).toBeNull();
  });
});

describe("softDeleteImage", () => {
  it("marks the row deleted_at and returns true", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const inserted = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.png",
      sizeBytes: 1,
    });
    expect(await softDeleteImage(db, workspaceId, inserted.id)).toBe(true);
  });

  it("returns false when the image doesn't exist", async () => {
    const { db, workspaceId } = await setupWorkspace();
    expect(await softDeleteImage(db, workspaceId, "ghost")).toBe(false);
  });

  it("returns false on second delete (already gone)", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const inserted = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.png",
      sizeBytes: 1,
    });
    await softDeleteImage(db, workspaceId, inserted.id);
    expect(await softDeleteImage(db, workspaceId, inserted.id)).toBe(false);
  });
});

describe("listImages", () => {
  it("returns images in newest-first order, scoped to workspace", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const first = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "a.png",
      sizeBytes: 1,
    });
    await new Promise((r) => setTimeout(r, 2));
    const second = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "b.png",
      sizeBytes: 2,
    });
    const list = await listImages(db, workspaceId);
    expect(list.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it("filters by pathPrefix when set", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "folder/a.png",
      sizeBytes: 1,
    });
    await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "folder/b.png",
      sizeBytes: 2,
    });
    await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "elsewhere/c.png",
      sizeBytes: 3,
    });
    const list = await listImages(db, workspaceId, {
      pathPrefix: "folder/",
    });
    expect(list.map((r) => r.path).sort()).toEqual(["folder/a.png", "folder/b.png"]);
  });

  it("honours limit + offset for paging", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    for (let i = 0; i < 5; i++) {
      await insertImage(db, {
        workspaceId,
        createdByUserId: userId,
        path: `img-${i}.png`,
        sizeBytes: 1,
      });
      // Small gap so created_at sorts deterministically.
      await new Promise((r) => setTimeout(r, 1));
    }
    const page1 = await listImages(db, workspaceId, { limit: 2 });
    const page2 = await listImages(db, workspaceId, { limit: 2, offset: 2 });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page1[0]?.id).not.toBe(page2[0]?.id);
  });

  it("excludes soft-deleted images", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const live = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "a.png",
      sizeBytes: 1,
    });
    const dead = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "b.png",
      sizeBytes: 1,
    });
    await softDeleteImage(db, workspaceId, dead.id);
    const list = await listImages(db, workspaceId);
    expect(list.map((r) => r.id)).toEqual([live.id]);
  });
});

// ─── documents ──────────────────────────────────────────────────

describe("documents — insert + find + list + delete", () => {
  it("inserts a document row with derived r2 key", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const row = await insertDocument(db, {
      workspaceId,
      createdByUserId: userId,
      path: "guides/setup.annot.html",
      sizeBytes: 5432,
      title: "Setup guide",
      blockCount: 12,
    });
    expect(row.title).toBe("Setup guide");
    expect(row.block_count).toBe(12);
    expect(row.document_r2_key).toBe(`${workspaceId}/documents/${row.id}/document.html`);
  });

  it("findDocumentByPath returns the matching row", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    await insertDocument(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.annot.html",
      sizeBytes: 100,
    });
    const found = await findDocumentByPath(db, workspaceId, "x.annot.html");
    expect(found?.path).toBe("x.annot.html");
  });

  it("updateDocument patches title + bumps updated_at", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const inserted = await insertDocument(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.annot.html",
      sizeBytes: 100,
      title: "Old",
    });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateDocument(db, workspaceId, inserted.id, {
      title: "New",
      blockCount: 8,
    });
    expect(updated?.title).toBe("New");
    expect(updated?.block_count).toBe(8);
    expect(updated?.updated_at).toBeGreaterThan(inserted.updated_at);
  });

  it("softDeleteDocument frees the path slot", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const first = await insertDocument(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.annot.html",
      sizeBytes: 1,
    });
    await softDeleteDocument(db, workspaceId, first.id);
    const second = await insertDocument(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.annot.html",
      sizeBytes: 2,
    });
    expect(second.id).not.toBe(first.id);
    expect(await findDocumentById(db, workspaceId, first.id)).toBeNull();
  });

  it("listDocuments excludes soft-deleted and orders newest-first", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const first = await insertDocument(db, {
      workspaceId,
      createdByUserId: userId,
      path: "a.annot.html",
      sizeBytes: 1,
    });
    await new Promise((r) => setTimeout(r, 2));
    const second = await insertDocument(db, {
      workspaceId,
      createdByUserId: userId,
      path: "b.annot.html",
      sizeBytes: 2,
    });
    const dead = await insertDocument(db, {
      workspaceId,
      createdByUserId: userId,
      path: "c.annot.html",
      sizeBytes: 3,
    });
    await softDeleteDocument(db, workspaceId, dead.id);
    const list = await listDocuments(db, workspaceId);
    expect(list.map((r) => r.id)).toEqual([second.id, first.id]);
  });
});

// ─── totalStorageUsedBytes ──────────────────────────────────────

describe("totalStorageUsedBytes", () => {
  it("sums size_bytes across images + documents", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "a.png",
      sizeBytes: 1000,
    });
    await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "b.png",
      sizeBytes: 2500,
    });
    await insertDocument(db, {
      workspaceId,
      createdByUserId: userId,
      path: "x.annot.html",
      sizeBytes: 800,
    });
    expect(await totalStorageUsedBytes(db, workspaceId)).toBe(1000 + 2500 + 800);
  });

  it("excludes soft-deleted rows", async () => {
    const { db, userId, workspaceId } = await setupWorkspace();
    const live = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "live.png",
      sizeBytes: 1000,
    });
    const dead = await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "dead.png",
      sizeBytes: 9999,
    });
    expect(live.id).toBeTruthy(); // sanity
    await softDeleteImage(db, workspaceId, dead.id);
    expect(await totalStorageUsedBytes(db, workspaceId)).toBe(1000);
  });

  it("returns 0 for an empty workspace", async () => {
    const { db, workspaceId } = await setupWorkspace();
    expect(await totalStorageUsedBytes(db, workspaceId)).toBe(0);
  });
});

// ─── audit_events ───────────────────────────────────────────────

describe("recordAuditEvent", () => {
  let db: D1Database;
  let userId: string;
  let workspaceId: string;
  beforeEach(async () => {
    const setup = await setupWorkspace();
    db = setup.db;
    userId = setup.userId;
    workspaceId = setup.workspaceId;
  });

  it("inserts an audit row with the expected fields", async () => {
    await recordAuditEvent(db, {
      workspaceId,
      userId,
      action: "image.upload",
      resourceType: "image",
      resourceId: "img-123",
      metadata: { size: 12345 },
    });
    const row = await db
      .prepare("SELECT * FROM audit_events WHERE action = ?")
      .bind("image.upload")
      .first<AuditEventRow>();
    expect(row?.workspace_id).toBe(workspaceId);
    expect(row?.user_id).toBe(userId);
    expect(row?.resource_type).toBe("image");
    expect(row?.resource_id).toBe("img-123");
    expect(JSON.parse(row?.metadata_json ?? "{}")).toEqual({ size: 12345 });
  });

  it("handles a null user_id (system-initiated event)", async () => {
    await recordAuditEvent(db, {
      workspaceId,
      userId: null,
      action: "system.cleanup",
    });
    const row = await db
      .prepare("SELECT * FROM audit_events WHERE action = ?")
      .bind("system.cleanup")
      .first<AuditEventRow>();
    expect(row?.user_id).toBeNull();
  });

  it("is best-effort (swallows D1 errors)", async () => {
    const broken = {
      prepare: () => ({
        bind: () => ({
          async run() {
            throw new Error("D1 transient");
          },
        }),
      }),
    } as unknown as D1Database;
    await expect(
      recordAuditEvent(broken, {
        workspaceId: "ws",
        userId: "u",
        action: "test",
      }),
    ).resolves.toBeUndefined();
  });
});
