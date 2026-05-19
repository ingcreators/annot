# Annot — Product Direction

> This document is the north star for product and technical decisions.
> Read it before designing a new feature, refactoring a package, or
> evaluating a PR. When a decision conflicts with something here,
> update this document as part of the change (don't silently diverge).

## The product in one sentence

Annot is **a screenshot annotation system built around a portable SVG
format** — shipped today as a PWA and browser extension, and intended
tomorrow as a programmable library that slots into automated testing
and CI workflows.

## Strategic direction

We are committing to two adjacent growth vectors:

1. **Playwright / headless automation integration.**
   The same SVG annotation core that powers the PWA will be callable
   from Node so that E2E tests, visual regression pipelines, and
   documentation generators can produce annotated screenshots
   automatically from `page.locator(...)` references.

2. **GitHub as the collaboration hub.**
   Annotated screenshots should flow natively into Issues, PRs, and
   CI artifacts. A GitHub Action posts them on PRs, a storage backend
   lets them live inside a repo under version control, and a
   "Share to GitHub" path connects the PWA to the collaboration loop
   developers already live in.

Neither vector is implemented yet. Current work on the PWA, extension,
and core should be done **as if these vectors were imminent** so the
eventual transition is a straight continuation, not a rewrite.

## What follows from this (core principles)

### P1. The SVG is the source of truth

PNGs are rendered artifacts. PPTX is a conversion output. The
`annotations.svg` is the canonical representation that must
round-trip losslessly through every component — PWA, extension,
future headless annotator, future GitHub storage.

- Every SVG writer tags the root with `data-annot-version="N"`.
- Any schema change bumps the version and ships a migration.
- New annotation types that can't be represented in this SVG format
  are blocked until the format is extended to cover them.

### P2. The core runs without a browser

The editor UI is browser-only. The **SVG-producing logic** that sits
underneath it must not depend on `document`, `window`,
`getComputedStyle`, or `getBoundingClientRect`. When a tool needs
measurements (e.g. text metrics) those come through a narrow
injectable interface, not a direct global reference.

This isn't retroactively enforced across every existing tool — but
**new code is written this way**, and existing code is migrated
opportunistically.

### P3. PPTX-representable is the default acceptance bar

A new annotation type should, before landing, have an answer to
"how does this become an OOXML shape on export?". If no natural
mapping exists, document the approximation up front. PPTX continues
to be a first-class output.

### P4. One storage interface, four (soon five) implementations

Annotations are read and written through `StorageProvider`. Never
import a concrete store (`LocalStore`, `FileSystemStore`, …) from
feature code. The interface stays stable so that `GitHubStore` can
be added without touching consumers.

When `StorageProvider` needs new methods, add them as **optional** so
existing implementations keep working until they opt in.

### P5. DOM metadata is a future locator bridge

`PageMetadata` / `PageElement` captured by the extension today will,
in the Playwright integration, be produced from `locator.boundingBox()`
instead. Keep the schema **additive**: new fields OK, removal or
semantic change NOT OK. Plan for a future `locator?: string` field
that the headless side populates.

### P6. Public API surface is explicit

`@ingcreators/annot-core` exposes two stable entry points:

- **`@ingcreators/annot-core`** — full surface including browser-only UI
  (CanvasManager, Toolbar, PropertyPanel, export helpers). Imported
  by PWA / extension / desktop.
- **`@ingcreators/annot-core/headless`** — DOM-free subset. Guaranteed
  importable from Node without pulling in `document` / `window` /
  `navigator`. Covers storage types, path utilities, SVG format
  versioning, pure constants, ZIP builder, and a few pure helpers.
  This is the entry point the future `@ingcreators/annot-annotator`,
  `@ingcreators/annot-playwright`, and `@ingcreators/annot-action` will import.

Anything exported from either entry is treated as stable for
downstream packages. Internal helpers live in per-module files that
are not re-exported from root. When adding a public symbol, mirror
between `src/index.ts` and `src/headless.ts` if it's DOM-free; add
to `src/index.ts` only if it's DOM-dependent.

### P7. URL scheme and deep links are reserved early

`annot://` is reserved for future deep links from Issues, Slack,
email, etc. into the editor. Don't repurpose it, and don't invent a
second scheme.

## Target package architecture

Naming convention: **`@ingcreators/annot-<role>`**. `ingcreators` is the
company scope (npm org); `annot` is this repository's product. Other
ingcreators products live in separate repositories and use the same
`@ingcreators/<product>-<role>` pattern.

Current:

```
@ingcreators/annot-core         Editor logic + SVG + PPTX export (browser)
@ingcreators/annot-web          PWA host
@ingcreators/annot-extension    Chrome extension (capture + handoff)
@ingcreators/annot-desktop      Electron desktop host
```

Target (additive, no renames to existing packages):

```
@ingcreators/annot-core         ← SVG-producing logic split out of editor
@ingcreators/annot-annotator    NEW: headless annotation library (Node + browser)
@ingcreators/annot-playwright   NEW: Playwright fixture / locator adapters
@ingcreators/annot-github       NEW: GitHub API client + OAuth + GitHubStore
@ingcreators/annot-action       NEW: GitHub Action wrapping annotator + github
@ingcreators/annot-cli          NEW (lower priority): CLI wrapper
@ingcreators/annot-web          (unchanged)
@ingcreators/annot-extension    (unchanged)
@ingcreators/annot-desktop      (unchanged)
```

## Non-goals

Things we are **not** doing, to keep scope honest:

- **Not** a video / GIF tool. Still images only.
- **Not** a full design tool. Annotation-scale editing, not Figma.
- **Not** a SaaS collaboration platform per se. The PWA stays local-
  first; GitHub is the collaboration layer we lean on.
- **Not** supporting Cypress / Puppeteer / Selenium as first-party
  integrations. Playwright only; others can come as community adapters.
- **Not** a visual regression diff tool. Annotated screenshots, not
  pixel diffing. (Pairing well with existing diff tools is welcome.)

## Decision template for new features / changes

Every non-trivial feature should answer these before implementation
begins. Paste this into the planning issue / doc:

```markdown
### Feature: <name>

**Which layer does this live in?**
- [ ] PWA / extension UI only (right-click menu, keyboard, layout…)
- [ ] Core — SVG authoring, annotation types, preset system
- [ ] Storage — file / folder operations
- [ ] Metadata — PageMetadata / PageElement schema

**Would a headless (Node / Playwright) caller need this?**
- [ ] Yes → must be implementable without DOM
- [ ] No → UI-only; note it clearly

**Does it change the SVG schema?**
- [ ] No
- [ ] Yes → bump `data-annot-version`, write a migration, update
      `docs/svg-format.md`

**Does it change `StorageProvider`?**
- [ ] No
- [ ] Yes → add as optional, document the 4 existing implementations'
      fallback behavior, note GitHubStore expectation

**PPTX round-trip story?**
- [ ] Covered by existing OOXML mapping
- [ ] Needs a new mapping — described below:
      …

**URL / scheme / deep-link implications?**
- [ ] None
- [ ] Touches `annot://` or router — described below
```

## Release / naming commitments

- **SVG format version**: starts at `1` with the introduction of
  `data-annot-version`. Incremented on schema-breaking changes.
- **npm scope reservation**: `@ingcreators/*` is the canonical scope.
  Unofficial / alternative scopes are not supported.
- **GitHub Marketplace**: Action will be published under
  `ingcreators/annot-action` (placeholder — confirm before launch).
- **URL scheme**: `annot://` reserved for the project. Contributors
  adding new deep links must document the new URL shape in
  `docs/url-schemes.md` (to be created).

## What's published on npm

As of 2026-05-19, the following packages are published on npm
under the `@ingcreators` scope. **Public API surface for these
packages is semver-versioned** — breaking changes require a
major bump per [semver](https://semver.org).

| Package | Version | Stability commitment |
|---------|---------|----------------------|
| [`@ingcreators/annot-core`](https://www.npmjs.com/package/@ingcreators/annot-core) | `0.1.0` | Root export (`.`) only on this version; subpaths (`/storage`, `/editor`, etc.) land in a later minor. Pre-1.0 — minor bumps may include breaking changes (with a changelog note). |
| [`@ingcreators/annot-annotator`](https://www.npmjs.com/package/@ingcreators/annot-annotator) | `0.1.0` | `createAnnotator(options) → { toPng, toSvg }` public API. Inlines its `annot-core` usage so consumers don't transitively pull the core SDK. |
| [`@ingcreators/annot-playwright`](https://www.npmjs.com/package/@ingcreators/annot-playwright) | `0.1.0` | `test.extend({ annotator })` Playwright fixture + the three pure SVG-fragment helpers (`rectForBoundingBox` / `arrowBetween` / `textAt`). |

Auth for publish is via [npm Trusted Publishing (OIDC)](https://docs.npmjs.com/trusted-publishers) —
no long-lived tokens. The workflow at `.github/workflows/publish.yml`
mints a per-run identity token via GitHub Actions OIDC, npm
verifies it against per-package Trusted Publisher rules, and
publish proceeds. Each package's Publishing Access is set to
"Require 2FA AND disallow tokens" so token-based publish is
structurally impossible.

### Not yet published

Other workspace packages stay `private: true` and are not
distributed via npm:

- Host apps: `annot-web` (PWA at annot.work), `annot-extension`
  (Chrome Web Store), `annot-desktop` (Electron self-distribute),
  `annot-vscode` (VSCode Marketplace) — distribution path is the
  host's own marketplace, not npm.
- Internal libraries: `annot-host-ui`, `annot-editor`,
  `annot-render`, `annot-doc`, `annot-capture`, `annot-cloud-store`,
  `annot-imagequant` — refactor freely within the monorepo; not
  contracted as external APIs yet.
- Server-side: `annot-worker` deploys to Cloudflare via
  `.github/workflows/deploy.yml`, not npm.

Future additions to the published set need: (a) a clear
external-API contract, (b) a `publishConfig` block flipping
the package to `public`, (c) a Trusted Publisher rule on
npm.com, (d) a Changesets entry.

## Revision history

| Date       | Change                                     |
|------------|--------------------------------------------|
| 2026-04-23 | Initial document. Committed to Playwright + GitHub direction. |
| 2026-05-19 | First npm publish — `annot-core@0.1.0`, `annot-annotator@0.1.0`, `annot-playwright@0.1.0`. Added "What's published" section. |
