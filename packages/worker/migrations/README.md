# D1 migrations

Wrangler-managed D1 migrations for `annot-api`'s `DB` binding.

## Convention

- Files named `NNNN_short_description.sql` (4-digit zero-padded
  sequence, snake_case description).
- Each migration is **idempotent** (`CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`) so re-applying against a partial
  state doesn't fail.
- Schema-additive only: new columns get `ALTER TABLE ADD COLUMN`
  + default value; never drop / rename existing columns.
- Each migration ends with a `-- Verified` comment listing the
  follow-up tests that exercise the changed shape.

## Local workflow

Create a local D1 instance (one-time per dev machine):

```sh
wrangler d1 create annot-db
```

Replace the `<replace-with-d1-database-id>` placeholder in
`packages/worker/wrangler.toml` with the printed `database_id`.

Apply migrations to the local emulator:

```sh
pnpm --filter @ingcreators/annot-worker exec wrangler d1 migrations apply annot-db --local
```

Apply to remote (after `wrangler login`):

```sh
pnpm --filter @ingcreators/annot-worker exec wrangler d1 migrations apply annot-db --remote
```

## Inspect

```sh
pnpm --filter @ingcreators/annot-worker exec wrangler d1 migrations list annot-db
pnpm --filter @ingcreators/annot-worker exec wrangler d1 execute annot-db --command "SELECT name FROM sqlite_master WHERE type='table'"
```

## Per-phase roadmap

- **0000_init.sql** (Phase 2b, this PR) — no-op placeholder so
  the migrations dir is a real wrangler-recognised target.
- **0001_auth.sql** (Phase 3) — `users`, `workspaces`,
  `workspace_members` tables.
- **0002_storage.sql** (Phase 4) — `images`, `documents`,
  `audit_events` tables.
- **0003_shares.sql** (Phase 5) — `share_links` table.
- **0004_github_apps.sql** (Phase 6 follow-up 5y-1) —
  `github_installations` table + embed-flow extension columns
  (`repo_policy` / `default_branch_override` / `build_hook_url`
  / `target_paths_json`). See
  `docs/plans/annot-cloud-roadmap.md` § "Phase 6 follow-up —
  Embedded editor + GitHub round-trip".
- **0005_billing.sql** (Phase 7) — Stripe-related columns +
  subscription state tables (lands from the `annot-cloud` private
  repo, not this OSS package).
