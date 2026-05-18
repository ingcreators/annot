// Tests for `user-repo.ts` against a real (in-memory) SQLite
// database seeded with the Phase 3 migration. Catches SQL syntax
// + constraint violations that wouldn't surface in a hand-rolled
// mock.

import { describe, expect, it } from "vitest";
import { makeMockD1Sqlite } from "./test-helpers.js";
import {
  findOrCreateUserFromProvider,
  type ProviderProfile,
  touchUserLastSeen,
  type UserRow,
} from "./user-repo.js";

const GITHUB_PROFILE: ProviderProfile = {
  provider: "github",
  providerUserId: "12706572",
  email: null, // GitHub private email case
  displayName: "Naoki Ichimura",
  avatarUrl: "https://avatars.githubusercontent.com/u/12706572",
};

const GOOGLE_PROFILE: ProviderProfile = {
  provider: "google",
  providerUserId: "google-sub-abc123",
  email: "user@example.com",
  displayName: "Example User",
  avatarUrl: "https://lh3.googleusercontent.com/...",
};

describe("findOrCreateUserFromProvider — first-time login", () => {
  it("creates a user row, workspace, and owner membership", async () => {
    const db = makeMockD1Sqlite();
    const result = await findOrCreateUserFromProvider(db, GITHUB_PROFILE);

    expect(result.created).toBe(true);
    expect(result.user.id).toBeTruthy();
    expect(result.user.github_id).toBe("12706572");
    expect(result.user.google_id).toBeNull();
    expect(result.user.display_name).toBe("Naoki Ichimura");
    expect(result.user.avatar_url).toBe("https://avatars.githubusercontent.com/u/12706572");
    expect(result.user.plan).toBe("free");
    expect(result.user.email).toBeNull();
    expect(result.user.deleted_at).toBeNull();

    expect(result.workspace.id).toBeTruthy();
    expect(result.workspace.owner_user_id).toBe(result.user.id);
    expect(result.workspace.plan).toBe("free");
    expect(result.workspace.name).toBe("Naoki Ichimura's workspace");

    // Verify the workspace_member row exists with role=owner.
    const member = await db
      .prepare("SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
      .bind(result.workspace.id, result.user.id)
      .first<{ role: string; accepted_at: number }>();
    expect(member).not.toBeNull();
    expect(member?.role).toBe("owner");
    expect(typeof member?.accepted_at).toBe("number");
  });

  it("creates a Google-side user (google_id set, github_id null)", async () => {
    const db = makeMockD1Sqlite();
    const result = await findOrCreateUserFromProvider(db, GOOGLE_PROFILE);

    expect(result.created).toBe(true);
    expect(result.user.google_id).toBe("google-sub-abc123");
    expect(result.user.github_id).toBeNull();
    expect(result.user.email).toBe("user@example.com");
  });

  it("uses 'Personal workspace' fallback when displayName is empty", async () => {
    const db = makeMockD1Sqlite();
    const result = await findOrCreateUserFromProvider(db, {
      ...GITHUB_PROFILE,
      displayName: "",
    });
    expect(result.workspace.name).toBe("Personal workspace");
  });

  it("uses created_at == updated_at == last_seen_at on first insert", async () => {
    const db = makeMockD1Sqlite();
    const result = await findOrCreateUserFromProvider(db, GITHUB_PROFILE);
    expect(result.user.created_at).toBe(result.user.updated_at);
    expect(result.user.created_at).toBe(result.user.last_seen_at);
  });
});

describe("findOrCreateUserFromProvider — returning user", () => {
  it("returns the same user + workspace on second call", async () => {
    const db = makeMockD1Sqlite();
    const first = await findOrCreateUserFromProvider(db, GITHUB_PROFILE);
    const second = await findOrCreateUserFromProvider(db, GITHUB_PROFILE);

    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(second.workspace.id).toBe(first.workspace.id);
  });

  it("doesn't create a second workspace for an existing user", async () => {
    const db = makeMockD1Sqlite();
    await findOrCreateUserFromProvider(db, GITHUB_PROFILE);
    await findOrCreateUserFromProvider(db, GITHUB_PROFILE);
    await findOrCreateUserFromProvider(db, GITHUB_PROFILE);

    const count = await db.prepare("SELECT COUNT(*) as n FROM workspaces").first<{ n: number }>();
    expect(count?.n).toBe(1);

    const memberCount = await db
      .prepare("SELECT COUNT(*) as n FROM workspace_members")
      .first<{ n: number }>();
    expect(memberCount?.n).toBe(1);
  });

  it("does not surface soft-deleted users", async () => {
    const db = makeMockD1Sqlite();
    const first = await findOrCreateUserFromProvider(db, GITHUB_PROFILE);

    // Soft-delete the user.
    await db
      .prepare("UPDATE users SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), first.user.id)
      .run();

    // Same GitHub OAuth login now creates a fresh user.
    const second = await findOrCreateUserFromProvider(db, GITHUB_PROFILE);
    expect(second.created).toBe(true);
    expect(second.user.id).not.toBe(first.user.id);
  });
});

describe("findOrCreateUserFromProvider — repair invariant", () => {
  it("creates a missing personal workspace for an existing user", async () => {
    const db = makeMockD1Sqlite();
    const first = await findOrCreateUserFromProvider(db, GITHUB_PROFILE);

    // Simulate the workspace getting deleted out from under the
    // user (e.g. an aborted crash mid-onboarding pre-Phase-3).
    await db.prepare("DELETE FROM workspaces WHERE id = ?").bind(first.workspace.id).run();
    await db
      .prepare("DELETE FROM workspace_members WHERE workspace_id = ?")
      .bind(first.workspace.id)
      .run();

    const repaired = await findOrCreateUserFromProvider(db, GITHUB_PROFILE);
    expect(repaired.created).toBe(false); // user was found
    expect(repaired.user.id).toBe(first.user.id);
    expect(repaired.workspace.id).not.toBe(first.workspace.id); // new
    expect(repaired.workspace.owner_user_id).toBe(first.user.id);
  });
});

describe("findOrCreateUserFromProvider — provider isolation", () => {
  it("separates GitHub and Google users with the same providerUserId", async () => {
    const db = makeMockD1Sqlite();
    // Two providers happen to return the same numeric ID.
    const sharedId = "55555";
    const gh = await findOrCreateUserFromProvider(db, {
      ...GITHUB_PROFILE,
      providerUserId: sharedId,
    });
    const goog = await findOrCreateUserFromProvider(db, {
      ...GOOGLE_PROFILE,
      providerUserId: sharedId,
    });
    expect(gh.user.id).not.toBe(goog.user.id);
    expect(gh.user.github_id).toBe(sharedId);
    expect(gh.user.google_id).toBeNull();
    expect(goog.user.github_id).toBeNull();
    expect(goog.user.google_id).toBe(sharedId);
  });
});

describe("touchUserLastSeen", () => {
  it("updates last_seen_at on the matching row", async () => {
    const db = makeMockD1Sqlite();
    const result = await findOrCreateUserFromProvider(db, GITHUB_PROFILE);
    const before = result.user.last_seen_at;

    // Sleep 5ms so the timestamps don't collide on fast machines.
    await new Promise((r) => setTimeout(r, 5));
    await touchUserLastSeen(db, result.user.id);

    const after = await db
      .prepare("SELECT last_seen_at FROM users WHERE id = ?")
      .bind(result.user.id)
      .first<{ last_seen_at: number }>();
    expect(after?.last_seen_at).toBeGreaterThan(before);
  });

  it("is a no-op for an unknown user id (no throw)", async () => {
    const db = makeMockD1Sqlite();
    await expect(
      touchUserLastSeen(db, "00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeUndefined();
  });

  it("swallows D1 errors silently (best-effort)", async () => {
    const broken = {
      prepare: () => ({
        bind: () => ({
          async run() {
            throw new Error("D1 transient failure");
          },
        }),
      }),
    } as unknown as D1Database;
    await expect(touchUserLastSeen(broken, "any")).resolves.toBeUndefined();
  });
});

describe("UNIQUE constraints (schema-level)", () => {
  it("enforces unique github_id across users", async () => {
    const db = makeMockD1Sqlite();
    await db
      .prepare(
        `INSERT INTO users (id, github_id, plan, created_at, updated_at, last_seen_at)
         VALUES ('id-a', '99', 'free', 1, 1, 1)`,
      )
      .run();
    await expect(
      db
        .prepare(
          `INSERT INTO users (id, github_id, plan, created_at, updated_at, last_seen_at)
           VALUES ('id-b', '99', 'free', 1, 1, 1)`,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("allows multiple users with NULL github_id (only google_id set)", async () => {
    const db = makeMockD1Sqlite();
    await db
      .prepare(
        `INSERT INTO users (id, google_id, plan, created_at, updated_at, last_seen_at)
         VALUES ('a', 'g-1', 'free', 1, 1, 1)`,
      )
      .run();
    // Same NULL for github_id, different google_id → fine.
    await db
      .prepare(
        `INSERT INTO users (id, google_id, plan, created_at, updated_at, last_seen_at)
         VALUES ('b', 'g-2', 'free', 1, 1, 1)`,
      )
      .run();
    const count = await db.prepare("SELECT COUNT(*) as n FROM users").first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it("typed read returns proper UserRow shape", async () => {
    const db = makeMockD1Sqlite();
    const result = await findOrCreateUserFromProvider(db, GITHUB_PROFILE);
    const row = await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(result.user.id)
      .first<UserRow>();
    expect(row).not.toBeNull();
    expect(row?.id).toBe(result.user.id);
    expect(row?.created_at).toBeTypeOf("number");
  });
});
