// Unit tests for the Phase 4e quota gate. Runs against SQLite
// (via `makeMockD1Sqlite`) so the live SQL is exercised.

import { describe, expect, it } from "vitest";
import { checkUploadQuota, PLAN_LIMITS } from "./plan-gates.js";
import { insertDocument, insertImage } from "./storage-repo.js";
import { makeMockD1Sqlite } from "./test-helpers.js";
import { findOrCreateUserFromProvider } from "./user-repo.js";

const PROFILE = {
  provider: "github" as const,
  providerUserId: "quota-test",
  email: null,
  displayName: "Quota Test",
  avatarUrl: "",
};

/** Spin up a SQLite-backed D1 + one workspace + (optionally)
 *  override the workspace's plan. */
async function setupWorkspace(plan: "free" | "pro" | "team" = "free") {
  const db = makeMockD1Sqlite();
  const upserted = await findOrCreateUserFromProvider(db, PROFILE);
  const workspaceId = upserted.workspace.id;
  const userId = upserted.user.id;
  if (plan !== "free") {
    await db.prepare("UPDATE workspaces SET plan = ? WHERE id = ?").bind(plan, workspaceId).run();
  }
  return { db, workspaceId, userId };
}

describe("PLAN_LIMITS", () => {
  it("free plan is intentionally permissive during Phase 4 beta", () => {
    expect(PLAN_LIMITS.free.storageBytes).toBe(5_000_000_000);
    expect(PLAN_LIMITS.free.activeDocuments).toBe(50);
  });

  it("pro plan is 50 GB / unlimited docs", () => {
    expect(PLAN_LIMITS.pro.storageBytes).toBe(50_000_000_000);
    expect(PLAN_LIMITS.pro.activeDocuments).toBe(Number.POSITIVE_INFINITY);
  });

  it("team plan is 500 GB / unlimited docs", () => {
    expect(PLAN_LIMITS.team.storageBytes).toBe(500_000_000_000);
    expect(PLAN_LIMITS.team.activeDocuments).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("checkUploadQuota — storage gate", () => {
  it("permits a small upload on an empty workspace", async () => {
    const { db, workspaceId } = await setupWorkspace();
    const result = await checkUploadQuota(db, workspaceId, 1_000_000);
    expect(result.ok).toBe(true);
    expect(result.plan).toBe("free");
    expect(result.usage.storageBytes).toBe(0);
  });

  it("permits an upload that fits within the free cap", async () => {
    const { db, workspaceId, userId } = await setupWorkspace();
    // Seed 1 GB of existing usage.
    await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "seed.png",
      sizeBytes: 1_000_000_000,
    });
    const result = await checkUploadQuota(db, workspaceId, 1_000_000);
    expect(result.ok).toBe(true);
    expect(result.usage.storageBytes).toBe(1_000_000_000);
  });

  it("rejects an upload that would push usage over the free cap", async () => {
    const { db, workspaceId, userId } = await setupWorkspace();
    // Seed 4.999 GB of usage (just under the 5 GB cap).
    await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "huge.png",
      sizeBytes: 4_999_000_000,
    });
    const result = await checkUploadQuota(db, workspaceId, 2_000_000);
    expect(result.ok).toBe(false);
    expect(result.exceeded).toBe("storage");
    expect(result.plan).toBe("free");
    expect(result.message).toMatch(/storage limit exceeded/);
  });

  it("permits the same upload on the pro plan", async () => {
    const { db, workspaceId, userId } = await setupWorkspace("pro");
    await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "huge.png",
      sizeBytes: 4_999_000_000,
    });
    const result = await checkUploadQuota(db, workspaceId, 2_000_000);
    expect(result.ok).toBe(true);
    expect(result.plan).toBe("pro");
  });

  it("counts both images and documents toward storage", async () => {
    const { db, workspaceId, userId } = await setupWorkspace();
    await insertImage(db, {
      workspaceId,
      createdByUserId: userId,
      path: "a.png",
      sizeBytes: 2_500_000_000,
    });
    await insertDocument(db, {
      workspaceId,
      createdByUserId: userId,
      path: "a.annot.html",
      sizeBytes: 2_500_000_000,
    });
    // Combined = 5 GB, exactly at the cap. +1 byte should fail.
    const result = await checkUploadQuota(db, workspaceId, 1);
    expect(result.ok).toBe(false);
    expect(result.exceeded).toBe("storage");
  });
});

describe("checkUploadQuota — document gate", () => {
  it("does NOT check document count when incrementsDocumentCount is false", async () => {
    const { db, workspaceId, userId } = await setupWorkspace();
    // Seed 50 documents (the free cap).
    for (let i = 0; i < 50; i++) {
      await insertDocument(db, {
        workspaceId,
        createdByUserId: userId,
        path: `doc-${i}.annot.html`,
        sizeBytes: 1000,
      });
    }
    // No `incrementsDocumentCount` — gate ignores doc count.
    const result = await checkUploadQuota(db, workspaceId, 1000);
    expect(result.ok).toBe(true);
  });

  it("rejects a new document upload that exceeds the free document cap", async () => {
    const { db, workspaceId, userId } = await setupWorkspace();
    for (let i = 0; i < 50; i++) {
      await insertDocument(db, {
        workspaceId,
        createdByUserId: userId,
        path: `doc-${i}.annot.html`,
        sizeBytes: 1000,
      });
    }
    const result = await checkUploadQuota(db, workspaceId, 1000, {
      incrementsDocumentCount: true,
    });
    expect(result.ok).toBe(false);
    expect(result.exceeded).toBe("documents");
    expect(result.usage.documentCount).toBe(50);
  });

  it("permits a new document under the cap", async () => {
    const { db, workspaceId, userId } = await setupWorkspace();
    for (let i = 0; i < 10; i++) {
      await insertDocument(db, {
        workspaceId,
        createdByUserId: userId,
        path: `doc-${i}.annot.html`,
        sizeBytes: 1000,
      });
    }
    const result = await checkUploadQuota(db, workspaceId, 1000, {
      incrementsDocumentCount: true,
    });
    expect(result.ok).toBe(true);
    expect(result.usage.documentCount).toBe(10);
  });

  it("permits unlimited documents on the pro plan", async () => {
    const { db, workspaceId, userId } = await setupWorkspace("pro");
    for (let i = 0; i < 100; i++) {
      await insertDocument(db, {
        workspaceId,
        createdByUserId: userId,
        path: `doc-${i}.annot.html`,
        sizeBytes: 1000,
      });
    }
    const result = await checkUploadQuota(db, workspaceId, 1000, {
      incrementsDocumentCount: true,
    });
    expect(result.ok).toBe(true);
  });
});

describe("checkUploadQuota — plan fallback", () => {
  it("treats an unknown plan string as free (defensive)", async () => {
    const { db, workspaceId } = await setupWorkspace();
    await db
      .prepare("UPDATE workspaces SET plan = ? WHERE id = ?")
      .bind("legacy_grandfathered_lol", workspaceId)
      .run();
    const result = await checkUploadQuota(db, workspaceId, 1000);
    expect(result.plan).toBe("free");
    expect(result.limits).toEqual(PLAN_LIMITS.free);
  });
});
