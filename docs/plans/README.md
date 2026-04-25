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

Plans being discussed (`Draft`), waiting for an implementation
window (`Queued`), or actively shipping (`In progress`).

| Plan | Status | Summary |
|------|--------|---------|
| [`path-based-storage.md`](./path-based-storage.md) | Queued | Drop numeric IDs across all storage implementations; use filesystem-style paths as primary key. Prerequisite for `GitHubStore`. |
| [`google-drive-integration.md`](./google-drive-integration.md) | Draft | Rework the Drive backend onto the non-sensitive `drive.file` scope + Workspace Marketplace + Drive UI Integration so Annot can ship publicly without a restricted-scope CASA audit. |
| [`oss-cloud-split.md`](./oss-cloud-split.md) | Draft | Forward-looking strategy for keeping Annot OSS while developing paid features in a separate private `annot-cloud` repo. Guardrails apply from today; concrete phases trigger on "first paid feature" and "company incorporation". |
| [`github-integration.md`](./github-integration.md) | Draft | Individual-user `GitHubStore` — device-flow auth, pick repo + branch + base path, commits as save. Drive-integration-equivalent scope. PR automation / Check Runs / org admin live in `annot-cloud`, not here. Phases 1–3 landed (#36–#38); Phase 4 polish in progress. |

## Recently landed plans

Most recent entries in [`_done/`](./_done/), newest first. The
historic full list is the directory itself; this table is the
"first-page" view a reader scanning the repo will see.

| Plan | Landed | Summary |
|------|--------|---------|
| [`_done/source-audit-cleanup.md`](./_done/source-audit-cleanup.md) | 2026-04-25 | Repo-hygiene + presentation pass for corporate adoption auditing. All seven phases shipped in [#100](https://github.com/ingcreators/annot/pull/100)–[#106](https://github.com/ingcreators/annot/pull/106): Apache-2.0 LICENSE + audit-facing root docs, plan-status hygiene, centralised logger shim, `any` triage in toolbar.ts and outside, `assertNonNull` helper + fragile DOM-lookup guards, README "for evaluators" section. |
| [`_done/lit-migration.md`](./_done/lit-migration.md) | 2026-04-25 | Multi-phase migration of `packages/web` UI from imperative DOM to Lit Web Components. All seven phases (0–6) shipped in [#85](https://github.com/ingcreators/annot/pull/85)–[#93](https://github.com/ingcreators/annot/pull/93); follow-up corner-case fixes in [#94](https://github.com/ingcreators/annot/pull/94)–[#98](https://github.com/ingcreators/annot/pull/98). |
| [`_done/storybook-introduction.md`](./_done/storybook-introduction.md) | 2026-04-25 | Storybook bootstrap in `packages/web` as the component showroom + visual-regression net for the Lit migration. Phase 1 landed in [#84](https://github.com/ingcreators/annot/pull/84); Phase 2 (CI-blocking) and beyond are explicitly optional follow-ups. |
| [`_done/plugin-ui-slots.md`](./_done/plugin-ui-slots.md) | 2026-04-25 | Drawer + right-panel become generic `UISection` hosts. Built-ins migrated; plugins register via split `addDrawerSection` / `addRightPanelSection`. Phases 1–3 landed in [#80](https://github.com/ingcreators/annot/pull/80)–[#82](https://github.com/ingcreators/annot/pull/82); optional Phase 4 polish deferred. |
| [`_done/plugin-sidebar-tabs.md`](./_done/plugin-sidebar-tabs.md) | 2026-04-25 | Sidebar "Views" section + section-priority ordering + setter-based tab API + built-in "Recent" tab. Phase 1 landed in [#78](https://github.com/ingcreators/annot/pull/78); optional Phase 2 visual polish deferred. |
| [`_done/plugin-storage-registration.md`](./_done/plugin-storage-registration.md) | 2026-04-25 | Open `storage/bridge.ts` to plugin-registered backends so `annot-cloud`'s pointer-commit store can land without a fork. Phases A, B, C landed in [#74](https://github.com/ingcreators/annot/pull/74)–[#76](https://github.com/ingcreators/annot/pull/76). |
| [`_done/app-decomposition.md`](./_done/app-decomposition.md) | 2026-04-25 | Break `packages/web/src/app.ts` (2.6k lines) into collaborator modules and ship a `PluginHost` MVP. Phases 0–5 + a 3.5 follow-up landed in [#65](https://github.com/ingcreators/annot/pull/65)–[#72](https://github.com/ingcreators/annot/pull/72); the three Phase-5 readiness-gate items each got their own follow-up plan (also landed). |

## Plan lifecycle

- **Draft** — being discussed, not yet decided.
- **Queued** — approved, waiting for implementation window.
- **In progress** — actively being implemented; link to tracking
  branch / PR if any.
- **Done** — landed; move the file to `_done/` and leave a one-line
  pointer in the table above if it's historically important.
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
