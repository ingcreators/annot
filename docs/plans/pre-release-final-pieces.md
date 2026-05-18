# Pre-release final pieces — `.github/` templates + Changesets

> **Status:** Partially landed. Stage 1 (`.github/` templates +
> `CODEOWNERS` + `FUNDING.yml`) landed 2026-05-18 as Phase 1 of
> [`annot-cloud-roadmap.md`](./annot-cloud-roadmap.md). Stage 2
> (Changesets bootstrap) is gated on Phase 6 of the same roadmap
> (`@ingcreators/annot-annotator` / `-playwright` npm publish).
> Authored 2026-04-27 as the cleanup-debt
> follow-up to the OSS contributor friction audit that produced
> [#227](https://github.com/ingcreators/annot/pull/227)–[#233](https://github.com/ingcreators/annot/pull/233)
> (Biome `noExplicitAny` warn, `PopupMessage` union fix, Node-version
> doc alignment, per-package READMEs, plan doc consolidation, and
> `pnpm catalog` for `typescript` / `vite`). Two related but
> independent gaps surfaced in that audit and stayed open: the
> repo has no GitHub issue / PR templates / `CODEOWNERS` /
> `FUNDING.yml`, and there is no release / version-management
> tooling beyond `version: "0.0.0"` literals across every package.
> Both are pre-release-only work — once contributors arrive in
> volume or once the first npm publish lands, fixing them in
> arrears costs more than fixing them now.
>
> **Compatibility:** Repository-level + tooling only. No production
> code touched. The Changesets stage adds `@changesets/cli` as a
> root devDependency and a `.changeset/` directory; nothing in
> `packages/*/dist` changes.
>
> **Risk:** Low and revertable per stage. Stage 1 is pure
> additive (templates + CODEOWNERS + FUNDING) — worst case the
> templates are wrong and we edit them in a follow-up. Stage 2
> introduces Changesets but does **not** flip any package to
> `private: false` or run `changeset publish` against npm — that
> trigger stays out of scope until the team explicitly decides
> to publish. The risk is therefore "we adopted Changesets and
> never used it"; mitigated by enforcing a "PR adds a changeset"
> check only after the first package opts in to publishing.

## Context

The senior-engineer audit run on 2026-04-27 (informally — the PR
descriptions for #227–#233 are the durable record) flagged five
medium-severity friction items beyond what
[`_done/pre-release-cleanup.md`](./_done/pre-release-cleanup.md)
already covered. Three landed in #227–#233 (lint rule, typed
extension messages, per-package READMEs). Two are queued here
because they are tooling decisions worth making once and
documenting, not one-line fixes:

1. **`.github/` templates** — A new contributor opening their
   first issue or PR has no scaffold to follow. CONTRIBUTING.md
   spells out the `Verified:` paragraph + Conventional Commits
   tone, but until those expectations live in a template the
   maintainer has to repeat them in review every time. Same
   story for `CODEOWNERS` (review routing — a single-maintainer
   project today, but the file is what GitHub reads to tag
   reviewers automatically once that changes), `FUNDING.yml`
   (sponsorship discoverability), and the issue forms (current
   "blank issue" experience offers zero structure for bug
   reproductions).

2. **Changesets** — Every workspace package is `version: "0.0.0"`
   today, which is fine for pre-release. But the moment we
   publish `@ingcreators/annot-core`, we need a way to:
     - Bump versions per package independently (the four hosts
       and three libraries don't move in lockstep).
     - Generate `CHANGELOG.md` entries from the PR-attached
       changeset notes (we already maintain a hand-curated
       `CHANGELOG.md` — Changesets can either replace it or
       layer onto it).
     - Decide between snapshot pre-release (`0.0.x-canary.N`)
       and proper semver releases.
   Doing this with shell scripts after the first publish is
   tractable but invites silent version drift. Adopting
   Changesets now — when nothing is published yet — means the
   first publish is "run `pnpm changeset version && pnpm
   publish -r --filter @ingcreators/annot-core`" rather than
   "design a release flow under deadline pressure".

   Pairs with the OSS / cloud split decision in
   [`oss-cloud-split.md`](./oss-cloud-split.md): once the
   `annot-cloud` private repo starts pulling specific
   `@ingcreators/*` versions, having immutable published
   versions matters more than the current "import via
   `workspace:*`" arrangement allows.

The two stages are intentionally **independent** — Stage 1 can
land without Stage 2 ever happening, and vice versa. They share
this plan only because both are tagged as "pre-release polish
that gets harder later" by the same audit.

## Goals

- A new contributor opening an issue gets a structured form
  (bug / feature / question) that asks for the repro context the
  maintainer would otherwise have to chase down in comments.
- Opening a PR auto-fills a description template that mirrors
  the `Verified:` checklist already in `CONTRIBUTING.md`, so the
  contributor doesn't have to remember it from a separate doc.
- `CODEOWNERS` exists with the current maintainer routing
  (single-entry today; structured so additions are mechanical).
- `FUNDING.yml` either documents the project's sponsorship
  channels or explicitly declares "none today" so the GitHub
  Sponsors heart icon doesn't render misleadingly.
- `pnpm changeset` is wired up: each PR that touches a
  publishable package can drop a `.changeset/<random-name>.md`
  file describing the change; the commit log retains its
  Conventional Commits style independent of the changeset notes.
- A documented (but not yet automated) path from "merge a PR" to
  "publish to npm" that we can switch on when the first package
  opts in to publishing.

## Non-goals

- **Not** flipping any package's `private: true` to publish.
  That decision is per-package and triggered separately —
  `@ingcreators/annot-core` is the obvious first candidate but
  even it isn't urgent.
- **Not** replacing `CHANGELOG.md`. The hand-curated changelog
  has been every-PR-since-day-one and continues to serve as the
  audit trail. Changesets generates per-package changelogs at
  publish time; the two coexist.
- **Not** introducing semantic-release / commitlint / a separate
  PR-title bot. Conventional Commits are already the convention
  but enforcement is a CONTRIBUTING.md ask, not an automated
  gate. Adding a commitlint check is a separate, larger
  discussion.
- **Not** adding a Discussions board, security policy template,
  or pull-request labeller bot. Each is reasonable but each is
  its own decision.

## Design

### Stage 1 — `.github/` templates + ownership metadata

Five files land under `.github/`:

- **`.github/ISSUE_TEMPLATE/bug_report.yml`** — GitHub Issue
  Form (YAML, structured fields). Fields:
    - Affected package (drop-down: core / editor / render / web /
      extension / desktop / docs / other) — populated from the
      monorepo layout in the root README.
    - Annot version (free text — `git rev-parse HEAD` while
      `version: "0.0.0"` is everywhere).
    - Browser / OS / Node version (free text).
    - Steps to reproduce (textarea, required).
    - Expected vs actual (textarea, required).
    - Console / network errors (textarea, optional).
- **`.github/ISSUE_TEMPLATE/feature_request.yml`** — Issue Form.
  Fields:
    - Problem statement ("what user-visible pain are you trying
      to solve") — required, framed deliberately to discourage
      "implement X" issues that skip the why.
    - Proposed solution sketch — optional.
    - Alternatives considered — optional.
    - Affected package — drop-down, same list as bug report.
- **`.github/ISSUE_TEMPLATE/config.yml`** — disable the "Open a
  blank issue" link (`blank_issues_enabled: false`); add a
  `contact_links:` entry pointing security reports at
  [`SECURITY.md`](../../SECURITY.md) so they don't land in
  public issues by accident.
- **`.github/pull_request_template.md`** — the template used by
  every PR. Mirrors the structure recent PRs use voluntarily
  (Summary / Why / Test plan), and prefills the
  `CONTRIBUTING.md` checkboxes (`pnpm -r typecheck`, `pnpm
  test`, `pnpm lint`, package builds, `data-annot-version`
  bump if SVG schema touched, `StorageProvider` impact, etc.).
  The `Verified:` paragraph stays in commit messages — the PR
  template covers the prose around the diff.
- **`.github/CODEOWNERS`** — single entry today:
  ```
  *  @ingmrn
  ```
  Plus a comment block explaining the conventions to follow as
  reviewers join (`packages/extension/  @ingmrn @maintainer-2`
  scoping, etc.).
- **`.github/FUNDING.yml`** — initial state explicit. Two
  options the maintainer should pick between:
    1. File present with `# none today` and a comment explaining
       why (the heart icon disappears).
    2. File absent (default GitHub behaviour — heart still
       appears but links nowhere useful).
  Stage 1 ships option 1 unless the maintainer opts otherwise
  during review.

Verification for Stage 1 is purely cosmetic: open an issue and a
PR through the GitHub UI, confirm the templates render. No
code-level test is meaningful.

### Stage 2 — Changesets bootstrap

Changesets is a known-quantity tool used by every monorepo of
comparable size (Vitest, Vite, Lit, Astro, etc.). Adoption is
three artifacts:

- **`@changesets/cli` as a root devDependency.** Pin via the
  catalog mechanism added in
  [#233](https://github.com/ingcreators/annot/pull/233) once
  it's ergonomic to do so (a one-package devDep doesn't earn
  catalog membership immediately).
- **`.changeset/config.json`** at the repo root, configured for:
    - `access: "restricted"` (we explicitly opt-in per package
      rather than defaulting to public — until npm publishing
      starts, this is theoretical anyway).
    - `baseBranch: "main"` (matches the squash-merge convention).
    - `updateInternalDependencies: "patch"` so a `patch`-level
      bump to `@ingcreators/annot-core` triggers matching
      `patch`-level bumps on its dependents (`annot-editor`,
      `annot-render`, `annot-web`, `annot-extension`,
      `annot-desktop`).
    - `linked: []` — packages move independently. (We can group
      `[annot-core, annot-editor, annot-render]` later if it
      turns out their version numbers usefully line up — but
      starting unlinked keeps maximum flexibility.)
    - `ignore: ["@ingcreators/annot-web", "@ingcreators/annot-extension", "@ingcreators/annot-desktop"]`
      until / unless those packages opt in to publishing. The
      hosts are end-user apps, not libraries; they don't need
      semantic-versioned npm publishes.
- **`.changeset/README.md`** describing the workflow for
  contributors:
    - "Run `pnpm changeset` after making your change. Pick the
      affected packages, bump level, and write a one-line
      description." (Even one-time changesets are valuable
      onboarding documentation.)
    - "PRs that don't touch publishable packages don't need a
      changeset."
    - "Maintainer runs `pnpm changeset version` to bump versions
      and update `CHANGELOG.md` files; commits the result; runs
      `pnpm changeset publish` to push to npm."

A `package.json` script (`"changeset": "changeset"`) makes the
common workflow `pnpm changeset` rather than `pnpm exec
changeset`.

**Crucially,** Stage 2 does **not**:
- Add a Changesets GitHub Action / bot — that's a separate
  decision (release-please-style automation has tradeoffs and
  we don't need it until publishing starts).
- Flip any package to `private: false`.
- Modify the existing root `CHANGELOG.md`. Changesets writes
  per-package `packages/*/CHANGELOG.md` files at publish time;
  the root changelog continues as the human-curated audit
  trail.

The verification for Stage 2 is `pnpm changeset --empty` (run
manually by the contributor or maintainer) — confirms the CLI
loads, the config is valid, and a no-op changeset round-trips.

## Phased plan

| Stage | Scope | PRs | Depends on |
|-------|-------|-----|------------|
| 1a | Issue templates (bug + feature + config) | 1 | — |
| 1b | PR template + `CODEOWNERS` + `FUNDING.yml` | 1 | — |
| 2  | Changesets bootstrap (no automation) | 1 | — |

Stages 1a and 1b can land in either order or as a single PR if
the diff is small enough; the split exists so the PR-template
wording (which deserves more review attention) doesn't stall the
issue-template forms. Stage 2 is independent of Stage 1
entirely.

## Verification

- **Stage 1a:** open a "new issue" via the GitHub UI on the
  branch's preview build (or a draft PR); confirm both forms
  render and required fields are required.
- **Stage 1b:** open a draft PR, confirm the template populates
  the body. Confirm GitHub picks up `CODEOWNERS` (auto-assigns
  the listed user as reviewer on the next opened PR). Confirm
  `FUNDING.yml` is parsed (the sidebar's heart icon either
  appears with the configured links or — in the "none today"
  variant — disappears).
- **Stage 2:** `pnpm install` succeeds with the new
  devDependency; `pnpm changeset --empty` runs without error;
  `pnpm changeset status` reports zero pending changesets on
  `main`; `.changeset/README.md` renders correctly on GitHub.

## Migration notes

- **No data migration.** SVG schema unchanged.
  `data-annot-version` unchanged. `StorageProvider` unchanged.
- **Existing CHANGELOG.md preserved.** Changesets' per-package
  changelogs (generated at publish time) are additive; the
  hand-curated root changelog remains the project-level audit
  trail.
- **CONTRIBUTING.md updated** alongside the templates so the
  three references (issue templates / PR template / Changesets
  workflow) live in one canonical doc.
- **No CI workflow added.** A future PR can wire
  `changesets/action` once we're ready to automate the
  version-PR + publish loop, but Stage 2 deliberately stops
  short of that.

## Out of scope (explicitly)

- **Discussions board.** Worth considering once issue volume
  justifies it; not blocking.
- **Security policy template** beyond what
  [`SECURITY.md`](../../SECURITY.md) already covers.
- **Pull-request labeller / triage bot.** No labels exist today;
  introducing one is a separate, opinionated change.
- **Commitlint / commitizen.** Conventional Commits are a
  convention enforced by review, not by tooling. If we want
  automated enforcement that's a separate plan.
- **Renovate.** Dependabot is already wired
  ([`.github/dependabot.yml`](../../.github/dependabot.yml)) and
  doing the job; adding Renovate is out of scope until Dependabot
  proves insufficient.
- **Storybook deploy / Chromatic.** Tracked separately as
  Phase 3+ of [`_done/storybook-introduction.md`](./_done/storybook-introduction.md).
