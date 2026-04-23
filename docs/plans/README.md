# Plans

> Design documents for queued and in-progress work. Each plan is a
> living doc — update the status header when state changes, and move
> to `_done/` when landed so the active list stays scannable.

Plans sit between `PRODUCT_DIRECTION.md` (the "why") and the code
(the "how it ended up"). They capture the "how we intend to do it"
before implementation, which is invaluable for:

- Landing big refactors cohesively (no half-merged states).
- Sharing intent when multiple sessions / contributors iterate.
- Letting Claude Code read the plan and resume work across context
  resets.

## Active plans

| Plan | Status | Summary |
|------|--------|---------|
| [`path-based-storage.md`](./path-based-storage.md) | Queued | Drop numeric IDs across all storage implementations; use filesystem-style paths as primary key. Prerequisite for `GitHubStore`. |
| [`google-drive-integration.md`](./google-drive-integration.md) | Draft | Rework the Drive backend onto the non-sensitive `drive.file` scope + Workspace Marketplace + Drive UI Integration so Annot can ship publicly without a restricted-scope CASA audit. |
| [`oss-cloud-split.md`](./oss-cloud-split.md) | Draft | Forward-looking strategy for keeping Annot OSS while developing paid features in a separate private `annot-cloud` repo. Guardrails apply from today; concrete phases trigger on "first paid feature" and "company incorporation". |
| [`github-integration.md`](./github-integration.md) | Draft | Individual-user `GitHubStore` — device-flow auth, pick repo + branch + base path, commits as save. Drive-integration-equivalent scope. PR automation / Check Runs / org admin live in `annot-cloud`, not here. |

## Plan lifecycle

- **Draft** — being discussed, not yet decided.
- **Queued** — approved, waiting for implementation window.
- **In progress** — actively being implemented; link to tracking
  branch / PR if any.
- **Done** — landed; move the file to `_done/` and leave a one-line
  pointer here if it's historically important.
- **Abandoned** — move to `_done/` with an `ABANDONED:` prefix in
  the file header explaining why.

## Adding a plan

Start the plan file with this header:

```markdown
# <title>

> **Status:** Draft | Queued | In progress | Done | Abandoned
> **Compatibility:** Which packages / systems are affected.
> **Risk:** Single landing vs phased, data migration needs,
>           breaking changes.

## Context
...

## Design
...

## Phased plan
...

## Verification
...

## Migration notes
...
```

Keep plans self-contained — future readers (including Claude Code
after context reset) should be able to execute from the plan alone
without chasing through chat history. Include:

- Rationale for non-obvious design choices.
- File paths that will be touched.
- Forward-looking notes (e.g. "how this enables X later").
