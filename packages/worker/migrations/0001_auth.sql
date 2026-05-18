-- Phase 3a — auth foundation: users, workspaces, workspace_members.
--
-- Schema designed multi-tenant from day 1 (per
-- `docs/plans/annot-cloud-roadmap.md`). Plan-related columns
-- (`plan`, `stripe_customer_id`, `stripe_subscription_id`,
-- `deleted_at`) land here so Phase 7's Stripe integration is a
-- code change without further migration.
--
-- Conventions:
-- - IDs are random URL-safe strings (UUIDv4 via crypto.randomUUID
--   in the worker code). Stored as TEXT so the worker doesn't have
--   to encode/decode for SQLite numeric IDs.
-- - Timestamps are Unix milliseconds (INTEGER, Date.now() in JS).
-- - Soft delete via nullable `deleted_at`; never actually used yet
--   but reserves the shape so future "Delete my account" flows
--   don't need a migration.
-- - `email` is nullable because GitHub users with private emails
--   surface as `null` from /user (Phase 3 doesn't yet call
--   /user/emails to dig deeper). Google OAuth always returns
--   email, so Google users land with email set.
-- - Foreign keys are documentary; SQLite/D1 doesn't enforce them
--   by default and we don't enable PRAGMA foreign_keys in D1.
--
-- Verified test fixture lives in `packages/worker/src/user-repo.test.ts`.

-- ─── users ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  email                TEXT,
  github_id            TEXT,
  google_id            TEXT,
  display_name         TEXT,
  avatar_url           TEXT,
  plan                 TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id   TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  last_seen_at         INTEGER NOT NULL,
  deleted_at           INTEGER
);

-- Provider IDs are unique when present AND not soft-deleted.
-- The `deleted_at IS NULL` filter is what lets a "delete my
-- account" flow free up the provider id for re-sign-up: the
-- old row keeps its provider_id for audit purposes but no
-- longer conflicts with a fresh insert from the same provider.
-- SQLite's UNIQUE on a nullable column accepts multiple NULLs,
-- so a user with only a google_id doesn't conflict with another
-- user with only a github_id either.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id
  ON users(github_id) WHERE github_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
  ON users(google_id) WHERE google_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users(email) WHERE email IS NOT NULL AND deleted_at IS NULL;

-- ─── workspaces ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  plan                    TEXT NOT NULL DEFAULT 'free',
  owner_user_id           TEXT NOT NULL REFERENCES users(id),
  stripe_subscription_id  TEXT,
  created_at              INTEGER NOT NULL,
  deleted_at              INTEGER
);

-- Look up workspaces by owner (for "list my workspaces" + the
-- personal-workspace lookup in `findOrCreateUserFromProvider`).
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user_id
  ON workspaces(owner_user_id);

-- ─── workspace_members ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  role          TEXT NOT NULL DEFAULT 'member',
  invited_at    INTEGER NOT NULL,
  accepted_at   INTEGER,
  PRIMARY KEY (workspace_id, user_id)
);

-- Look up workspaces by user (for "list workspaces I'm in") — the
-- workspace_id half of the composite PK already serves the
-- "members of this workspace" direction.
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id
  ON workspace_members(user_id);
