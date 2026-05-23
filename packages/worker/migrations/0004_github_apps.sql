-- Phase 6 follow-up 5y-1 — GitHub App installations + embed flow
-- columns.
--
-- The `github_installations` table tracks GitHub App installations
-- that customers grant to the annot-cloud editor. Each row is one
-- GitHub-side installation (a user's personal account, or an org)
-- that the editor can mint installation tokens against.
--
-- The cloud-roadmap "Multi-tenant DB schema (D1)" section reserves
-- the base shape (id / account_login / account_type / workspace_id
-- / installed_at / suspended_at). This migration adds those plus
-- the columns the embed feature consumes:
--
--   repo_policy             how 5y-4's commit endpoint writes:
--                           'pr-mode' opens a PR; 'direct-push'
--                           pushes straight to the default branch.
--                           Defaults to 'pr-mode' (the safer
--                           choice per OQ-05 of
--                           docs/plans/living-spec-authoring-roadmap.md).
--   default_branch_override per-installation override of the
--                           repo's default branch when committing
--                           (e.g. customers using `docs` as the
--                           docs source).
--   build_hook_url          where 5z-1 pings after a successful
--                           commit (Cloudflare Pages / Vercel /
--                           GitHub Pages dispatch URL).
--   target_paths_json       JSON allowlist of `<repo>/<path-prefix>`
--                           pairs the App is authorised to commit
--                           under. NULL = no allowlist (the
--                           installation's repo set is the only
--                           gate). Populated by the customer's
--                           dashboard once 5y-3's setup lands.
--
-- The table is created here (not in 0001 / 0002 / 0003) because
-- no prior phase needed GitHub-App-based GitHub access; the OAuth
-- token from sign-in is enough for read-your-own-profile, and
-- the existing GitHubStore in `@ingcreators/annot-web` uses the
-- user's own PAT for repo writes.
--
-- Verified test fixture lives in
-- `packages/worker/src/embed/github-app.test.ts`.

CREATE TABLE IF NOT EXISTS github_installations (
  -- GitHub-assigned installation id (integer). Stored as INTEGER
  -- so JOIN-with-D1-int comparisons stay efficient; the worker
  -- code wraps it in `number` (safe — GitHub-assigned IDs stay
  -- under 2^53).
  id                       INTEGER PRIMARY KEY,
  -- GitHub account login the App is installed under (e.g.
  -- "octocat" for a user installation, "github" for an org).
  account_login            TEXT NOT NULL,
  -- 'User' or 'Organization' — mirrors GitHub's
  -- `installation.account.type` field.
  account_type             TEXT NOT NULL,
  -- Workspace the installation belongs to. Nullable for the
  -- transitional period where an unauthenticated webhook receives
  -- an installation event before the user has signed in to claim
  -- it via the dashboard. Once claimed, this points at the
  -- workspace that owns the installation row.
  workspace_id             TEXT REFERENCES workspaces(id),
  installed_at             INTEGER NOT NULL,
  suspended_at             INTEGER,
  -- Embed-flow columns (5y / 5z) ─────────────────────────────────
  -- 'pr-mode' | 'direct-push'. Default 'pr-mode' so a stale row
  -- without an explicit policy is safe.
  repo_policy              TEXT NOT NULL DEFAULT 'pr-mode',
  default_branch_override  TEXT,
  build_hook_url           TEXT,
  target_paths_json        TEXT
);

-- Look up by account_login (for the dashboard's "show me my
-- installations" UI + the webhook handler's lookup-by-account
-- path).
CREATE INDEX IF NOT EXISTS idx_github_installations_account_login
  ON github_installations(account_login) WHERE suspended_at IS NULL;

-- Look up by workspace (for the dashboard's "installations on
-- this workspace" UI + the embed-flow's authorise-by-workspace
-- path).
CREATE INDEX IF NOT EXISTS idx_github_installations_workspace_id
  ON github_installations(workspace_id) WHERE workspace_id IS NOT NULL AND suspended_at IS NULL;

-- Verified: `packages/worker/src/embed/github-app.test.ts`
-- exercises insert + lookup paths under the SQLite-backed D1
-- mock seeded from this directory.
