-- Initial migration — intentionally empty.
--
-- Phase 2b lands the D1 binding without any tables. Phase 3
-- adds the first real schema (`users`, `workspaces`,
-- `workspace_members`) and subsequent phases extend.
--
-- Why a zero-table init exists at all:
-- - `wrangler d1 migrations apply` only runs when there's at
--   least one migration file; having `0000_init.sql` present
--   means the operator's setup command works even before any
--   real tables land.
-- - The directory existence + naming convention (`NNNN_*.sql`)
--   is what subsequent phases extend; introducing it now keeps
--   each phase's diff focused on schema rather than tooling.

-- (intentionally no-op)
SELECT 1;
