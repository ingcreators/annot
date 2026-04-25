# Source-Code Audit Cleanup

> **Status:** Draft. Authored 2026-04-25 in response to a request
> to evaluate Annot from the perspective of a corporate IT
> auditor / system administrator vetting the project for adoption.
>
> **Compatibility:** No public-API changes. The work is mostly
> documentation + repo-hygiene + dead-code removal; minor type
> tightening within `packages/web` and `packages/extension`.
> Each phase is self-contained and individually revertable.
>
> **Risk:** Low per phase, low cumulative. The 243-test suite +
> Storybook visual checks + dev-server smoke gate every change.

## Why this plan

A corporate IT or security team evaluating Annot for internal
adoption will spend their first hour skimming the repository:

1. **Repo root** — `README`, `LICENSE`, `SECURITY.md`,
   `CHANGELOG.md`, `CONTRIBUTING.md`. These signal "is this
   project mature enough to bet on?".
2. **Active plan list** — does it match reality? Mismatches
   ("Phase 1 in progress" while it landed three weeks ago) read
   as stale governance.
3. **Code spot-checks** — `console.log`, `: any`, TODO / FIXME,
   `@ts-ignore`. A handful of each is normal; a thicket reads as
   "ship-and-fix-later" culture.
4. **Naming + structure** — does the layout match the README's
   description of it? Are there orphan files / stale comments
   referencing internal plan documents?

Annot is in good shape on the deep stuff: TC39 standard
decorators, strict `tsconfig.base.json` (full strict + override +
no-fallthrough + no-unchecked-indexed-access), one bundler per
target, a published two-entry-point public API
(`@ingcreators/annot-core` + `/headless`), Biome 2 + Vitest 4 +
TS 6, and a Lit migration plan that landed all six phases. There
is no dead code in the structural sense — what we have is
**presentation polish** that tilts an audit from "sketchy hobby
project" to "vendor-ready".

## Goals

After this plan lands, an auditor opening the repository should
see:

- A complete `LICENSE` file, `SECURITY.md` policy,
  `CONTRIBUTING.md`, `CHANGELOG.md`, and a
  `CODE_OF_CONDUCT.md` or equivalent.
- A `package.json` at root with `name`, `description`,
  `version`, `license`, and `repository` filled in coherently
  (today: `name: "ingcreators"`, no description, no version, no
  license).
- A `docs/plans/` index whose status column matches `main`
  (today: 7 of 10 entries say Queued / In-progress for work that
  has fully landed).
- Source files where `console.log` is reserved for explicit
  user-facing telemetry, not leftover `[debug]` traces.
- Source files where `any` and `as any` are absent or
  individually justified.
- No orphan test fixtures, no committed build artifacts (today:
  `packages/web/storybook-static/` is in `.gitignore` ✓).

## Non-goals

- **No new features.** This plan is purely cleanup. New plugin
  surfaces, storage backends, etc. land via their own
  `docs/plans/` documents.
- **No bundle-size optimisation.** Worth doing eventually but
  out of scope for an audit-prep pass.
- **No Lit-to-decorators migration.** Tracked separately in
  `lit-migration.md`'s "future direction"; doesn't move the
  audit needle.
- **No new tests for already-tested code.** Coverage gaps
  surfaced incidentally during cleanup may get a regression
  test (matching the established pattern), but a coverage push
  for its own sake is a separate plan.
- **No package renames.** `@ingcreators/annot-<role>` is the
  established naming.

## Findings

Spot-check counts captured 2026-04-25 against `main` HEAD:

| Concern | Count | Files / examples |
|---------|-------|------------------|
| `: any` / `as any` | 100 | top: `toolbar.ts` (26), extension `service-worker.ts` (9), `google-auth.ts` (9), `bridge.ts` (6), `pwa-capture.ts` (6) |
| `console.log` | 46 | sidebar.stories (10), extension service-worker (10), bridge.ts (5), error-bar.stories (4), encode/index.ts (4), content/index.ts (3), extension-transfer-host (2), app.ts (2) |
| `!.` non-null asserts | 69 | spread across `packages/web` |
| `TODO` / `FIXME` / `XXX` / `HACK` | 1 | trivial |
| `@ts-ignore` / `@ts-expect-error` | 0 | clean |
| Diff markers in source | 0 | clean |
| Internal `docs/plans/...` refs | 33 source files | informative for contributors, but several reference plans whose status hasn't been updated |
| Stale plan entries | 7 of 10 | `app-decomposition`, `plugin-storage-registration`, `plugin-sidebar-tabs`, `plugin-ui-slots`, `storybook-introduction`, `lit-migration`, `oss-cloud-split` (parts) all landed; index still says Queued / In-progress |
| Committed Storybook output | None | already in `.gitignore` ✓ |
| Root metadata gaps | 5 | `name: "ingcreators"`, missing `description`, `version`, `license`, no top-level keywords |
| Missing repo-root docs | 4 | `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` (or equivalent) |
| Missing UX gloss | 1 | no `CODE_OF_CONDUCT.md` (low priority but visible to auditors) |

Most counts are reasonable for a project of this size — the
issue is **legibility**, not raw quality. A 100-`any` count
across 200+ source files is < 0.5 per file; spreading
justifications inline (or replacing with proper types) costs
maybe a day.

## Phases

Each phase is its own PR. Phases are independently revertable
and don't share branches.

### Phase 1 — repo-root metadata + license

Land the high-signal "first impression" files. **No source
changes**, just text + JSON.

- **`LICENSE`** at root. Match the license decision
  (PRODUCT_DIRECTION.md + the per-package `package.json`
  fields). If the repo doesn't have an explicit license today,
  pick one (MIT or Apache-2.0 for an OSS project; or a
  business-source license if the cloud-split plan implies
  it). **Decision needed at sign-off.**
- **`SECURITY.md`** with a responsible-disclosure mailbox + a
  brief threat model summary (storage backends, OAuth scopes,
  capture-permission gating). One page.
- **`CONTRIBUTING.md`** distilled from `CLAUDE.md`'s landing
  rules section — branch / PR / commit conventions, lint /
  typecheck / test gates, plan-first rule. Auditors don't need
  to read CLAUDE.md (it's AI-flavoured); they need the human
  contributor onboarding.
- **`CODE_OF_CONDUCT.md`** — Contributor Covenant 2.1 verbatim.
- **`CHANGELOG.md`** at root, generated from `git log --merges
  main` rolling forward; subsequent releases append manually.
  Keeps the audit trail visible without forcing a release-train
  process.
- **Root `package.json`** — fill in `name`,
  `description`, `version`, `license`, `keywords`,
  `homepage`, `bugs`, `author` so `pnpm pack` would produce a
  publishable shape (the package itself stays `private: true`).

Expected delta: ~6 new files, ~30 lines on root
`package.json`. Roughly 200 lines net.

### Phase 2 — plan-status hygiene

Bring `docs/plans/README.md` and the per-plan status headers
into sync with `main`. The index currently lists 7 plans as
Queued / In-progress that have fully landed.

- For each landed plan: change status header from `Queued` /
  `In progress` to `Done`, add a one-line "landed in PRs #N–#M"
  link.
- Move `Done` plans to `docs/plans/_done/` per the lifecycle
  defined in `docs/plans/README.md`.
- Refresh `docs/plans/README.md` with two tables: **Active
  plans** (Draft / Queued / In progress) and **Recently landed
  plans** (the last 8 from `_done/`).
- Update inline source-comment cross-references that point at
  plan files. Where the comment says "as part of Phase X of
  ..." for landed work, keep the plan ref but add a `(landed)`
  marker so a reader doesn't think the plan is still open.

Expected delta: ~30 doc moves / edits, ~50 source-comment
tweaks. Roughly 300 lines net (mostly status header changes).

### Phase 3 — `console.log` triage

46 `console.log` lines. Triage:

- **Stories** (sidebar / error-bar / etc.) — keep. Storybook
  callbacks are the right place to demonstrate arg flows.
  Tag them with a one-line comment so the audit pass next
  time recognises them as intentional.
- **Capture / save / restore pipeline** (`bridge.ts`,
  `extension-transfer-host`, `gallery/page`, `editor-session`)
  — convert to a `logger` shim
  (`packages/web/src/logger.ts`) that defaults to
  `console.log` but exposes `setLogLevel("warn")` so deployers
  can quiet them. Auditors then see "centralised logging"
  rather than scattered `console.log`.
- **Service worker** (extension) — same logger shim, gated by
  a build-time `__DEV__` flag so production builds drop the
  traces.
- **Stragglers** — delete or reduce to `console.warn` /
  `console.error` when they're surfacing unusual states.

Expected delta: ~10-line `logger.ts` + ~46 call-site updates.
Roughly 100 lines net.

### Phase 4 — `any` triage in toolbar.ts

26 of the 100 `any` usages live in `packages/web/src/editor/toolbar.ts`
— the largest contiguous concentration. Most are
`(window as any).__anno_openFile` style escape hatches for
Tauri-host bridge globals; a few are leftover from the core →
web relocation in Phase 5a.

- Declare a `WindowWithAnnotBridges` interface in a single
  `tauri-bridge-globals.d.ts` typing the four `__anno_*`
  symbols Annot expects on `window`.
- Replace `(window as any).__anno_*` with
  `(window as unknown as WindowWithAnnotBridges).__anno_*`
  using the declared shape. Or, cleaner, augment the global
  `Window` interface in the .d.ts so the casts disappear
  entirely.
- Audit remaining `: any` (e.g. drag-drop event types) and
  swap for the right DOM event type.

Expected delta: ~30 lines net (one new .d.ts, ~26 toolbar
edits, a handful of follow-on call sites).

### Phase 5 — `any` cleanup outside toolbar.ts

The remaining ~74 `any` occurrences. Hot spots:

- **Storage providers** (`google-auth`, `github-auth`,
  `device-store`, `bridge`) — typed via `as any` for Drive /
  Octokit response payloads. Replace with narrow interface
  types pulled from the official typings packages
  (`@types/google.accounts`, `@octokit/types`). Both are
  already transitive deps.
- **Extension service worker** — `chrome.scripting.executeScript`
  result casts. Use `chrome-types` more aggressively (we
  already include it as a dev dep).
- **Capture pipeline** (`pwa-capture`) — `MediaTrackConstraints`
  / `DisplayMediaStreamOptions` evolved across browsers; some
  casts remain. Pin to the latest TS lib.dom.

Expected delta: ~150 lines net across ~10 files.

### Phase 6 — `!.` non-null assertion review

69 non-null assertions. Most are legitimate (`array.find(...)!`
when the search must succeed by construction). A handful in
`Toolbar.#render`'s post-Lit-shell wiring path were the source
of [annot#96](https://github.com/ingcreators/annot/pull/96) —
those should turn into proper runtime guards, not silent lies.

- Audit each `!`. For each, ask:
  - Is there a real construction-time guarantee? Add a comment
    documenting *why* the assertion holds.
  - Is the guarantee fragile (e.g. depends on a Lit element's
    render cycle)? Replace with a runtime check + early
    return + `console.error` if violated.
- Encode the surviving cases via a shared
  `assertNonNull<T>(v: T | null | undefined, msg: string): T`
  utility so production sites surface a meaningful message
  instead of "Cannot read properties of null".

Expected delta: ~80 lines net, including the assert helper +
a handful of production guards replacing assertions.

### Phase 7 — README + auditor-facing index

The `README.md` is solid for contributors but doesn't surface
the things an auditor wants to see in the first 30 seconds.
Append a short **"For evaluators"** section above the existing
"Monorepo layout" section:

- One-paragraph what + who-it-targets.
- Test count + lint state badge (CI-driven).
- Link to `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`.
- Link to `PRODUCT_DIRECTION.md` for strategy + the OSS-cloud
  split plan for transparency about commercial intent.
- Link to `docs/plans/_done/` index showing landed work in the
  last quarter.
- Storybook live URL (when CI starts publishing it as a
  GitHub Pages artifact — separate plan, but mention as
  "coming").

Expected delta: ~80 lines added to `README.md`.

## Sequencing + dependencies

- Phases 1, 2, 7 are **doc-only** — they can land in any order.
- Phases 3, 4, 5, 6 are **source-touching** — they should land
  AFTER Phase 1 (so the License + Security policy are visible
  while the source diffs ramp up) and run roughly in order
  (3 → 4 → 5 → 6) so each PR's diff stays focused on a single
  concern.
- Phase 7 (README polish) should land last so it can reference
  the artifacts the earlier phases produced.

## Verification

At every phase:

- `pnpm -r typecheck` clean (no new errors introduced).
- `pnpm test` — 243-test floor maintained; new tests
  proportional to substantive changes.
- `pnpm lint` — 0 findings.
- `pnpm --filter @ingcreators/annot-web build` — clean.
- `pnpm --filter @ingcreators/annot-web build-storybook` — clean.
- Dev-server smoke (Phases 4–6 only): editor + gallery boot
  without console errors after the affected source changes.

## Open questions for sign-off

1. **License choice.** MIT, Apache-2.0, BUSL-1.1, or other?
   Affects every package's `package.json` `license` field +
   the root `LICENSE` file. The OSS-cloud split plan
   (`docs/plans/oss-cloud-split.md`) implies the OSS repo
   stays permissive while paid features live in a private
   Cloud repo — Apache-2.0 vs MIT would be defensible.
2. **Logger shim scope.** Should the logger live in `core` (so
   the extension + future headless annotator share it) or
   `web` (gallery / editor only)? Lean web for now; promote
   later if needed.
3. **Plan-cleanup PR sizing.** Plan-status hygiene (Phase 2)
   could land as one big PR or split per landed plan. Default
   to one PR — it's mechanical doc-moving.
4. **`SECURITY.md` mailbox.** Does the project want a
   dedicated `security@ingcreators.com` alias, or is GitHub's
   private vulnerability reporting (PVR) enabled? GitHub PVR
   is the modern path and avoids the "dead inbox" failure
   mode.
5. **`__anno_*` global types.** Should these be exported from
   `packages/core` (so future hosts can ambient-augment
   `Window` once) or stay in `packages/web` since only the
   PWA + Tauri shells set them?

## References

- [`README.md`](../../README.md) — project overview.
- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) —
  strategic direction.
- [`CLAUDE.md`](../../CLAUDE.md) — contributor / Claude Code
  operational guide; source of `CONTRIBUTING.md` distillation.
- [`docs/plans/oss-cloud-split.md`](./oss-cloud-split.md) —
  commercial-split rationale; informs license + audit-trail
  decisions.
- [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)
  — the standard text for `CODE_OF_CONDUCT.md`.
