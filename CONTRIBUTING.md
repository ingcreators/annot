# Contributing to Annot

Thanks for taking the time to look at the code. This file is the
short, human-oriented version of the contribution conventions —
the long version (with rationale and historical context) lives in
[`CLAUDE.md`](./CLAUDE.md), which is also the operational guide
for AI assistants working on this codebase.

## Code of Conduct

We follow the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md).
By participating in this project you agree to abide by its terms.

## Reporting issues

- **Bugs / feature ideas** — open a GitHub issue on this
  repository. Include reproduction steps and the affected
  package (`@ingcreators/annot-core`,
  `@ingcreators/annot-web`, `@ingcreators/annot-extension`,
  `@ingcreators/annot-desktop`).
- **Security vulnerabilities** — see [`SECURITY.md`](./SECURITY.md).
  Please do **not** open a public issue or PR for security
  problems; use GitHub Private Vulnerability Reporting instead.

## Development setup

```bash
# Requires Node 20+ and pnpm 9+. We pin pnpm via the
# `packageManager` field in package.json so corepack picks the
# right version automatically.
pnpm install

# Type-check every package
pnpm -r typecheck

# Run the test suite (Vitest, ~250 tests)
pnpm test

# Lint (Biome 2)
pnpm lint

# Boot the PWA dev server (annot-web)
pnpm --filter @ingcreators/annot-web dev
```

The monorepo layout is described in [`README.md`](./README.md).
Each package has its own `package.json` with package-specific
scripts; `turbo` orchestrates builds across them.

## Branch + PR workflow

- **All changes land via pull request, never directly to `main`.**
  Even one-line docs tweaks go through a topic branch + PR.
  The `main` history is entirely squash-merged PRs (visible by
  the `(#NN)` suffix in `git log`); direct commits break that
  shape.
- **Topic branch name**: `<type>/<short-kebab-desc>`
  (e.g. `feat/sidebar-views-section`, `fix/drawer-rename-race`,
  `docs/contributing-guide`). `<type>` follows the
  [Conventional Commits] verb you'll use in the commit itself.
- **Commit & PR title style**: Conventional Commits, matching
  recent `git log` entries (`feat(web): …`, `fix(extension): …`,
  `refactor(core): …`, `docs(plans): …`, `chore(tooling): …`).

[Conventional Commits]: https://www.conventionalcommits.org/

### Commit message body

- Wrap at ~72 columns. For larger bodies use Markdown `##`
  subsections — recent merges use `## Scope`, `## Why`, `## Fix
  pattern`, and a closing `Verified:` paragraph listing the
  commands run (typecheck, test pass count, lint, builds).
- **No `Co-Authored-By:` trailers**, including the Claude Code
  default. The `main` history has zero such trailers; we keep
  it that way and mention AI assistance in the PR description
  when it's worth noting (so it carries context without
  polluting the permanent commit log).

### Phased plans: one PR per phase

Larger work lands via a `docs/plans/` document — see
[`docs/plans/README.md`](./docs/plans/README.md) for the
lifecycle. When a plan defines phases, **each phase ships as its
own independent PR**, merged before the next phase starts. Don't
chain feature branches: a phase-2 PR must have phase-1 on `main`
as its base. Each phase PR must be revertable in isolation.

The plan doc is the source of truth for phase boundaries; amend
the plan if reality diverges, don't silently re-slice phases.

## Quality gates

Before opening a PR, please run:

- [ ] `pnpm -r typecheck` — clean
- [ ] `pnpm test` — all passing (note the pass count in your
      `Verified:` paragraph)
- [ ] `pnpm lint` — 0 findings
- [ ] `pnpm --filter <changed-package> build` — clean for every
      package whose source changed (CI builds core / web /
      extension; desktop is opt-in)
- [ ] If touching the SVG schema, bump `data-annot-version` and
      add a note to `docs/svg-format.md`
- [ ] If touching `StorageProvider`, all four implementations
      compile AND the change is marked optional for any future
      backend
- [ ] If touching `PageMetadata` / `PageElement`, the change is
      purely additive (no renames, no field removals)
- [ ] No new DOM dependencies in `packages/core` outside of the
      editor UI layer
- [ ] Diagnostic `console.log` lines removed (or clearly marked
      `// DEBUG:` with a cleanup ticket)

## Architectural guardrails

These follow from
[`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md) — please skim
when touching adjacent code:

1. **SVG format integrity** — every annotation SVG carries
   `data-annot-version="N"`; parsers are defensive against
   missing / older versions.
2. **DOM independence in `core`** — new SVG-producing code in
   `packages/core/src/editor/tools/*` and
   `packages/core/src/svg/*` should not touch `document`,
   `window`, `getComputedStyle`, or `getBoundingClientRect` at
   the generation layer. Editing UI (selection handles, text
   caret, property panel) can use DOM APIs freely — that lives
   only in the PWA and is fine.
3. **`StorageProvider` is the only way in** — feature code never
   imports a concrete storage class; it uses the
   `StorageProvider` dependency injected at boot. New methods
   are added as optional fields on the interface.
4. **`PageMetadata` schema is additive-only** — see the gate
   list above.
5. **Public API of `@ingcreators/annot-core`** — two stable
   entry points: `@ingcreators/annot-core` (full surface,
   browser-only allowed) and `@ingcreators/annot-core/headless`
   (DOM-free subset, safe to import from Node). New DOM-free
   symbols go in both; new DOM-dependent symbols go only in
   the full entry.

## License of contributions

By submitting a contribution, you agree that your contribution
is licensed under the terms of the [Apache License, Version 2.0]
(see [`LICENSE`](./LICENSE)). The
[Apache License §5](./LICENSE) treats every submitted contribution
as automatically licensed under the same terms unless you state
otherwise; this matches our intent.

[Apache License, Version 2.0]: https://www.apache.org/licenses/LICENSE-2.0

If your employer or another entity holds copyright on
contributions you'd like to make, please coordinate with them
before opening the PR — Apache-2.0's contribution clause assumes
you have authority to license what you submit.

## Documentation conventions

- **Code comments are in English.** User-facing UI strings are
  mostly English with some Japanese (the project's primary
  audience to date). Repository-wide commits / PR descriptions /
  comments are English so the audit trail is consistent.
- **Comments explain the *why*, not the *what***. Long block
  comments referencing design decisions or related plans are
  encouraged when they save a future reader from re-deriving
  the context.
- **Reply / discussion language**: feel free to reply in the
  language you're comfortable with on issues / PRs; we'll
  follow.

## Help

If anything in this guide is unclear or contradicts what you
see in the code, that's a bug in the guide. Open an issue or
PR with the fix.
