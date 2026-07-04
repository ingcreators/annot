-- Phase 6 follow-up (security hardening) — record the GitHub user
-- who installed the App, so the claim step
-- (`PATCH /api/embed/installations/:id`) can verify the claimant IS
-- that installer instead of letting ANY authenticated annot.work
-- user claim an unclaimed installation (and thereby gain read /
-- commit access to that account's repos through the App).
--
-- Both columns are populated from the `installation.created`
-- webhook's top-level `sender` object (see
-- `packages/worker/src/embed/webhook.ts`):
--
--   installed_by_id     GitHub's numeric user id of the installer.
--                       The robust match key — it survives GitHub
--                       username changes. The claim gate compares
--                       this against the session's `providerUserId`.
--   installed_by_login  GitHub login of the installer, kept for
--                       human-readable audit / error messages.
--
-- Nullable on purpose: rows created before this migration, and rows
-- seeded by the UNAUTHENTICATED manifest-setup callback (which has
-- no `sender`), carry NULL. The claim gate fails CLOSED on a NULL
-- installer — see `checkClaimantIsInstaller` in
-- `packages/worker/src/embed/github-app.ts`. Self-host operators
-- with direct D1 access can always claim by writing `workspace_id`
-- (or `installed_by_id`) on the row manually.
--
-- Additive-only, per the CLAUDE.md §"ElementTree / schema" additive
-- discipline applied to the D1 schema: two new nullable columns, no
-- rename / drop of existing columns.

ALTER TABLE github_installations ADD COLUMN installed_by_login TEXT;
ALTER TABLE github_installations ADD COLUMN installed_by_id INTEGER;

-- Verified: `packages/worker/src/embed/github-app.test.ts` +
-- `build-trigger.test.ts` exercise the capture + claim-gate paths
-- under the SQLite-backed D1 mock seeded from this directory.
