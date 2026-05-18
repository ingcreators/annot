// User + workspace persistence — Phase 3 (multi-tenant DB).
//
// Sits between the OAuth handlers and D1. Provides
// `findOrCreateUserFromProvider`, which is the single function the
// OAuth callbacks call after they've fetched the upstream user
// profile.
//
// Design notes:
// - **Find-then-create**: SELECT by provider id; if missing,
//   INSERT. The race-condition window is closed by the UNIQUE
//   indexes on `github_id` / `google_id`. The catch handler
//   re-reads on UNIQUE conflict so two simultaneous OAuth
//   callbacks for the same user converge on one row.
// - **One personal workspace per user**: created alongside the
//   user on first login. Membership row marks them as `owner`.
//   This is the "your stuff" workspace; team workspaces (Phase 3
//   onwards) come from explicit Settings flows.
// - **ID generation**: `crypto.randomUUID()`. Available in the
//   Workers runtime and Node test runtime; URL-safe via the
//   standard `xxxxxxxx-xxxx-...` hex form.
// - **Timestamps**: Unix milliseconds via `Date.now()`. Stored
//   as INTEGER in D1 (no timezone confusion).
//
// Production src — MUST NOT import from `node:*`.

const NOW = () => Date.now();
const newId = () => crypto.randomUUID();

/**
 * Provider profile carried into the database layer. Built by
 * `auth-github.ts` (and Phase 3c `auth-google.ts`) from the
 * upstream `/user` response.
 */
export interface ProviderProfile {
  provider: "github" | "google";
  /** Provider's user id, stringified. */
  providerUserId: string;
  /** Verified email if available; null for GitHub private emails. */
  email: string | null;
  /** Display name; may be empty string if the provider returns null. */
  displayName: string;
  /** Avatar URL; may be empty string. */
  avatarUrl: string;
}

/** Row shape mirroring the `users` table. Mostly INTERNAL — the
 *  caller's view (session record, /me response) is narrower. */
export interface UserRow {
  id: string;
  email: string | null;
  github_id: string | null;
  google_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  plan: string;
  stripe_customer_id: string | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number;
  deleted_at: number | null;
}

/** Row shape mirroring the `workspaces` table. */
export interface WorkspaceRow {
  id: string;
  name: string;
  plan: string;
  owner_user_id: string;
  stripe_subscription_id: string | null;
  created_at: number;
  deleted_at: number | null;
}

/**
 * Resolve the user identified by a provider profile, creating
 * the user row + their personal workspace + the owner-membership
 * row if this is the first time we've seen them.
 *
 * Behaviour:
 * - If a row exists with matching `github_id` or `google_id`:
 *   re-use it, return its personal workspace.
 * - Otherwise: create a fresh user row, a personal workspace,
 *   and an `owner` membership in a single batch.
 * - Race-safe: if two callbacks try to create the same user
 *   simultaneously, the second insert hits the UNIQUE constraint
 *   and we re-fetch the row the winner created.
 */
export async function findOrCreateUserFromProvider(
  db: D1Database,
  profile: ProviderProfile,
): Promise<{ user: UserRow; workspace: WorkspaceRow; created: boolean }> {
  const existingUser = await findUserByProviderId(db, profile);
  if (existingUser) {
    const workspace = await getPersonalWorkspace(db, existingUser.id);
    if (!workspace) {
      // The user row exists but its personal workspace doesn't
      // — repair the invariant. Can happen if a prior callback
      // crashed between the user INSERT and the workspace INSERT.
      const repaired = await createPersonalWorkspace(db, existingUser.id, profile.displayName);
      return { user: existingUser, workspace: repaired, created: false };
    }
    return { user: existingUser, workspace, created: false };
  }

  // First-time login. Try to insert; race-check on UNIQUE violation.
  try {
    const user = await insertUser(db, profile);
    const workspace = await createPersonalWorkspace(db, user.id, profile.displayName);
    return { user, workspace, created: true };
  } catch (err) {
    // Likely a UNIQUE constraint hit — another callback for the
    // same provider id won the race. Re-fetch and return that.
    const raced = await findUserByProviderId(db, profile);
    if (!raced) throw err;
    const workspace = await getPersonalWorkspace(db, raced.id);
    return {
      user: raced,
      workspace: workspace ?? (await createPersonalWorkspace(db, raced.id, profile.displayName)),
      created: false,
    };
  }
}

async function findUserByProviderId(
  db: D1Database,
  profile: ProviderProfile,
): Promise<UserRow | null> {
  const column = profile.provider === "github" ? "github_id" : "google_id";
  return await db
    .prepare(`SELECT * FROM users WHERE ${column} = ? AND deleted_at IS NULL LIMIT 1`)
    .bind(profile.providerUserId)
    .first<UserRow>();
}

async function insertUser(db: D1Database, profile: ProviderProfile): Promise<UserRow> {
  const id = newId();
  const now = NOW();
  const githubId = profile.provider === "github" ? profile.providerUserId : null;
  const googleId = profile.provider === "google" ? profile.providerUserId : null;

  await db
    .prepare(
      `INSERT INTO users (
        id, email, github_id, google_id, display_name, avatar_url,
        plan, created_at, updated_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'free', ?, ?, ?)`,
    )
    .bind(
      id,
      profile.email,
      githubId,
      googleId,
      profile.displayName || null,
      profile.avatarUrl || null,
      now,
      now,
      now,
    )
    .run();

  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  if (!row) {
    throw new Error(`User row vanished immediately after INSERT (id=${id}). D1 binding bug?`);
  }
  return row;
}

async function getPersonalWorkspace(db: D1Database, userId: string): Promise<WorkspaceRow | null> {
  return await db
    .prepare(
      `SELECT * FROM workspaces
       WHERE owner_user_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .bind(userId)
    .first<WorkspaceRow>();
}

async function createPersonalWorkspace(
  db: D1Database,
  userId: string,
  ownerDisplayName: string,
): Promise<WorkspaceRow> {
  const id = newId();
  const now = NOW();
  const name = ownerDisplayName ? `${ownerDisplayName}'s workspace` : "Personal workspace";

  await db
    .prepare(
      `INSERT INTO workspaces (
        id, name, plan, owner_user_id, created_at
      ) VALUES (?, ?, 'free', ?, ?)`,
    )
    .bind(id, name, userId, now)
    .run();

  await db
    .prepare(
      `INSERT INTO workspace_members (
        workspace_id, user_id, role, invited_at, accepted_at
      ) VALUES (?, ?, 'owner', ?, ?)`,
    )
    .bind(id, userId, now, now)
    .run();

  const row = await db
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .bind(id)
    .first<WorkspaceRow>();
  if (!row) {
    throw new Error(`Workspace row vanished immediately after INSERT (id=${id}). D1 binding bug?`);
  }
  return row;
}

/**
 * Touch `users.last_seen_at` to `Date.now()`. Called from
 * `/api/auth/me` so we can surface "last active" in future UI
 * without hitting GitHub / Google APIs.
 *
 * Best-effort: failure to write is logged but does NOT fail the
 * caller (the user is identified by an existing session; touching
 * the timestamp is a side effect).
 */
export async function touchUserLastSeen(db: D1Database, userId: string): Promise<void> {
  try {
    await db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(NOW(), userId).run();
  } catch (err) {
    console.warn(`[user-repo] touchUserLastSeen failed for ${userId}:`, err);
  }
}
