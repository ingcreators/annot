# CLAUDE.md — Working notes for Claude Code

> This file orients Claude Code (and any future AI assistant) for work
> in this repository. Read this before making non-trivial changes.
> The authoritative product direction lives in
> [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md); this file is the
> operational companion.

## TL;DR

- **Annot** is a screenshot annotation tool (PWA + Chrome extension +
  Tauri desktop), built on a shared SVG-first core.
- The **strategic direction** is to extract that core as a headless
  library usable from Playwright / Node and integrate it tightly with
  GitHub. See [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md).
- **Code comments are in English**; user-facing UI strings are mostly
  English with some Japanese. Repository-wide commits / comments use
  English.
- The user works in Japanese. **Reply to the user in Japanese** unless
  they switch to English. Code, comments, docs, commit messages: English.

## Map of documentation

| File | Role |
|------|------|
| [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md) | Strategic north star + principles |
| [`CLAUDE.md`](./CLAUDE.md) (this file) | Operational guidance for Claude Code |
| [`docs/svg-format.md`](./docs/svg-format.md) | Canonical SVG annotation format reference |
| [`docs/url-schemes.md`](./docs/url-schemes.md) | Web routes + reserved `annot://` scheme |
| [`docs/plans/`](./docs/plans/) | Queued / in-progress design plans |

## Monorepo layout

```
packages/
  core/       Editor core — SVG tools, PPTX export, storage types.
              Imported by every host. This is the future
              "headless annotator" boundary.
              npm name: @ingcreators/annot-core
  web/        PWA host. Owns routing, storage impls, right panel.
              npm name: @ingcreators/annot-web
  extension/  Chrome MV3 extension. Capture pipeline + offscreen
              encode + content-script DOM metadata.
              npm name: @ingcreators/annot-extension
  desktop/    Tauri desktop wrapper.
              npm name: @ingcreators/annot-desktop
```

Naming convention: **`@ingcreators/annot-<role>`** for every package.
`ingcreators` is the company (npm org); `annot` is the product name.
Other products at ingcreators live in separate repositories under the
same `@ingcreators/<product>-<role>` pattern.

## Commands

```bash
pnpm -r typecheck                                      # full typecheck
pnpm --filter @ingcreators/annot-core typecheck        # single package
pnpm --filter @ingcreators/annot-web build
pnpm --filter @ingcreators/annot-extension build
pnpm -r build                                          # full build (uses turbo)
```

Vite is the bundler for every browser-targeted package. Builds are
fast (sub-second for `annot-web`). **Always build the changed
package** before declaring a task done — type errors in test configs
don't always surface in typecheck alone, and the Vite build catches
circular imports / missing exports that tsc misses.

## Architectural guardrails (enforce in reviews)

These follow from `PRODUCT_DIRECTION.md`. When modifying code, check:

### 1. SVG format integrity

- Every annotation SVG written by Annot should carry
  `data-annot-version="N"` on its root element.
- Parsers must be defensive against missing / older versions.
- Adding a new annotation type? Confirm it survives round-trip:
  **write → reload → compare SVG byte-for-byte**.

### 2. DOM independence in `core`

- **New SVG-producing code** in `packages/core/src/editor/tools/*` or
  `packages/core/src/svg/*` should NOT reference `document`,
  `window`, `getComputedStyle`, or `getBoundingClientRect` at the
  generation layer.
- Editing UI (selection handles, text caret, property panel) can
  freely use DOM APIs — it's PWA-only.
- Shared helpers that need measurements should accept a metrics
  provider interface rather than calling the browser directly.

### 3. StorageProvider is the only way in

- Never `import { LocalStore } from "..."` in feature code. Use
  the `StorageProvider` dependency injected at boot.
- New storage methods are **optional on the interface**, and feature
  code checks `if (store.method)` before calling.
- Schema for paths / names follows the plan in
  [`docs/plans/path-based-storage.md`](./docs/plans/path-based-storage.md)
  (queued).

### 4. PageMetadata schema is additive-only

- Location: `packages/core/src/storage/types.ts`
  (`PageMetadata`, `PageElement`).
- OK: add optional fields, add optional sub-objects.
- NOT OK: rename existing fields, change the semantics of a field,
  remove a field.
- Future-proofing: Playwright integration will populate a
  `locator?: string` field. Treat that name as reserved.

### 5. Public API of `@ingcreators/annot-core`

**The root entry is headless by construction.** `src/index.ts`
just `export * from "./headless.js"` — the two are
indistinguishable. Browser-side consumers reach the editor UI,
XMP, and Tauri-bridge symbols through their respective subpaths:

| Subpath | Surface |
|---------|---------|
| `@ingcreators/annot-core` (or `/headless`) | DOM-free: SVG format versioning, storage types, path utilities, capability predicates, dash utils, constants, id, assertNonNull, ZIP builder. **Importable in pure Node.** |
| `@ingcreators/annot-core/editor` | Editor UI: `CanvasManager`, `PropertyPanel`, `SelectionManager`, `History`, `ToolBase`, the `export*Svg*` / `copy*` / `save*` / `download*` / `getPng*` / `render*` helpers, theme toggle, anchored popover, icon catalogues. |
| `@ingcreators/annot-core/storage` | Storage value types (`ImageRecord`, `FolderRecord`, `PageElement`, `PageMetadata`, `StorageProvider`). |
| `@ingcreators/annot-core/utils` | Pure utilities: `assertNonNull`, `computeDasharray`, `detectDashKey`, `newIdB58`, `DEFAULT_*` constants. |
| `@ingcreators/annot-core/xmp` | `createEditableImage` / `readEditableImage` round-trip. |
| `@ingcreators/annot-core/tauri-bridge` | Tauri IPC + `isTauri` detection. |
| `@ingcreators/annot-core/editor/<file>` | Per-file deep imports for editor internals (`property-controls`, `tools/freehand-tool`, etc.). Use sparingly. |

Rules when adding public symbols:

- New DOM-free symbols → export from `src/headless.ts`. They
  flow into the root automatically via `export *`.
- New DOM-dependent UI symbols → export from
  `src/editor/index.ts`. **Never** add them to `headless.ts` or
  the root.
- New Tauri-bridge / XMP / extension-only symbols → put them in
  the matching subpath module; don't bounce them through
  `core/utils/index.ts` (that subpath is "pure utilities" by
  contract — see Stage 4-3 of `docs/plans/pre-release-cleanup.md`).
- The boundary is enforced by `packages/core/src/headless.test.ts`,
  which imports the root under a pure-Node vitest environment
  and asserts `globalThis.document` / `globalThis.window` stay
  `undefined`. Add a probe there if you introduce a new
  load-time global.

### 6. Reply and commit language

- Replies to the user: **Japanese**.
- Code, comments, commit messages, PR descriptions: **English**.
- When in doubt, match the language of surrounding text in the file
  being edited.

## Component stories (Storybook)

Storybook lives in
[`packages/web/.storybook/`](./packages/web/.storybook/) per
[`docs/plans/_done/storybook-introduction.md`](./docs/plans/_done/storybook-introduction.md).
Run locally with `pnpm --filter @ingcreators/annot-web storybook`.
CI builds the static bundle on every PR (currently
non-blocking); flipped to blocking in a later phase.

- **New Lit components ship with a co-located
  `*.stories.ts`** next to their `*.ts` source. Story
  variants cover every visible state the component can land
  in (idle / loading / empty / populated / error etc.). The
  rule is documented in
  [`docs/plans/_done/lit-migration.md`](./docs/plans/_done/lit-migration.md)
  — every Lit migration PR's test plan expects Storybook
  screenshots demonstrating pre-Lit / post-Lit visual
  equivalence.
- **Vanilla components don't need retroactive stories.** The
  five initial stories (`SaveStatusIndicator`, `ErrorBar`,
  `drawer.file`, `FileDetailsDrawer`, `Sidebar`) were
  written to bootstrap Storybook; further vanilla-component
  stories are optional and land opportunistically when a
  component is about to be Lit-migrated.
- **Stories are not test replacements.** Vitest stays the
  unit-test home; Storybook is the visual + interactive
  surface for reviewers + future plugin authors.

## Lit conventions

Lit is the UI framework for `packages/web`. Introduced in
Phase 0 of
[`docs/plans/_done/lit-migration.md`](./docs/plans/_done/lit-migration.md);
subsequent phases migrate built-in UI surfaces one at a time.

- **Custom-element prefix: `annot-`.** `<annot-save-status>`,
  `<annot-error-bar>`, `<annot-file-details-drawer>`, etc.
  Plugin authors may use their own prefix; built-in elements
  always use `annot-`.
- **No experimental decorators.** Never set
  `experimentalDecorators: true` in any tsconfig. The TC39
  standard-decorators form Lit 3 supports requires the
  `accessor` keyword, which Vite 8's oxc transformer leaves
  intact and Node 24's V8 can't parse — so Phase 0 elements
  declare reactive properties via Lit's runtime
  `static properties` API instead:

  ```ts
  export class AnnotSaveStatusElement extends LitElement {
    static override properties = {
      status: { type: String },
    };
    // `declare` is type-only so Lit's reactive getter/setter
    // isn't shadowed by a class-field initializer at ES2022.
    declare status: SaveStatus;
    constructor() {
      super();
      this.status = "saved";
    }
    // …
  }
  customElements.define("annot-save-status", AnnotSaveStatusElement);
  ```

  When the toolchain gains stable `accessor` transpilation,
  we can revisit and migrate to the decorator form in a
  follow-up PR.
- **Import Lit from `@ingcreators/annot-web/lit`, not `lit`
  directly.** Built-in modules and plugin authors both go
  through the subpath re-export
  ([`packages/web/src/lit.ts`](./packages/web/src/lit.ts)).
  This keeps one `LitElement` identity across host + plugin
  code so `instanceof` checks work, and lets us bump Lit
  centrally. The only exception is `packages/web/src/lit.ts`
  itself, which re-exports from `lit`.
- **Light DOM while migrating.** Phase migrations start by
  rendering to light DOM (`createRenderRoot() { return this; }`)
  so the existing global CSS in `editor.css` / `app.css`
  applies unchanged. Newly-written component CSS can move
  into scoped `static styles` opportunistically — the
  "hybrid CSS" approach decided at sign-off. Don't wholesale-
  rewrite the stylesheet as part of a migration.
- **Every Lit component ships a co-located `*.stories.ts`**
  per the Storybook convention above.

## Landing rules

### Branch + PR workflow

- **All changes land via PR, never directly committed to `main`.**
  Even a one-line docs tweak goes through a topic branch + PR. The
  existing `main` history is entirely squash-merged PRs (visible by
  the `(#NN)` suffix in `git log`); direct commits break that shape.
- Topic branch name: `<type>/<short-kebab-desc>`
  (e.g. `refactor/app-phase0-extract-helpers`,
  `docs/claude-md-landing-rules`). `<type>` follows the Conventional
  Commits verb used for the commit itself.
- Commit & PR title style: Conventional Commits, matching the tone
  of recent `git log` entries
  (`refactor(web): …`, `docs(plans): …`, `chore(tsconfig): …`).
- Claude Code opens the PR and reports the URL. **Merging is the
  user's call** — never run `gh pr merge`, and never force-push to
  `main` or to a PR branch the user is reviewing without explicit
  confirmation.
- If a change has accidentally landed on local `main`, the recovery
  is: branch it off → `git reset --hard origin/main` → push the
  branch → open the PR. The branch preserves the work; the reset
  only rewinds the local main pointer.

### Phased plans: one PR per phase

For work broken into phases inside a `docs/plans/` document:

- **Each phase lands as its own independent PR, merged before the
  next phase starts.** Don't chain feature branches; a phase-2 PR
  must have phase-1 on `main` as its base.
- Each phase PR must be revertable in isolation — a later revert
  of phase N shouldn't force a revert of phase N+1.
- The plan doc is the source of truth for phase boundaries; amend
  the plan if reality diverges, don't silently re-slice phases.

### Commit message body

- Wrap at ~72 columns. Use Markdown `##` subsections for larger
  bodies (Scope / Fix pattern / Why / Verified are common choices —
  see recent `git log` for examples).
- End non-trivial commits with a `Verified:` paragraph listing what
  was run (e.g. `pnpm -r typecheck`, `pnpm test` with the pass
  count, `pnpm lint — 0 findings`, `pnpm --filter <pkgs> build`).
  This mirrors the current main-history convention and keeps the
  reviewer's next steps short.
- **Do not add `Co-Authored-By:` trailers** (including the Claude
  Code default). The existing `main` history has zero such trailers;
  keeping commits consistent matters more than the attribution.
  When AI assistance is worth noting, mention it in the PR
  description instead, where it can carry context without polluting
  the permanent commit log.

## Plan-first for non-trivial work

`docs/plans/` is the staging ground for work that's too big to
land in a single small PR: large refactors, new storage backends,
new cross-package features, architectural shifts. The convention:

- **Write a plan before the implementation PR.** The plan doc goes
  into `docs/plans/` with a status header (`Draft` / `Queued` / `In
  progress` / `Done` / `Abandoned`) — see
  [`docs/plans/README.md`](./docs/plans/README.md) for the lifecycle
  and required header fields.
- Don't start implementation until the plan is at least `Queued`
  (i.e. the user has signed off on the approach). `Draft` means
  still-under-discussion.
- When implementation lands, the plan stays as-is for history; once
  fully done, move it to `docs/plans/_done/` and leave a one-line
  pointer in the active index if the plan is historically important.
- A plan should be self-contained enough that a fresh Claude Code
  session can resume work from the file alone after a context reset.

Small, obviously-scoped changes (bug fixes, one-file refactors,
dependency bumps, typo-level docs) don't need a plan — go straight
to a PR. The test is whether a reviewer would want to see the
approach discussed before the diff, or is happy reading the diff
first.

## Pre-landing checklist for new features

Before declaring a feature done:

- [ ] `pnpm -r typecheck` passes (or the single-package variant
      for a scoped change)
- [ ] `pnpm test` passes — note the pass count in the commit's
      `Verified:` paragraph
- [ ] `pnpm lint` (Biome) reports **0 findings**; CI blocks on this
- [ ] `pnpm --filter <pkg> build` passes for every package whose
      source changed (CI builds core / web / extension; desktop is
      opt-in)
- [ ] If the SVG schema changed, `data-annot-version` is bumped and
      a note added to `docs/svg-format.md` (create if missing)
- [ ] If `StorageProvider` changed, all four existing implementations
      compile AND the change is marked optional for the future
      GitHubStore
- [ ] If `PageMetadata` / `PageElement` changed, the change is purely
      additive
- [ ] No new DOM dependencies introduced into `packages/core` outside
      of the editor UI layer
- [ ] Diagnostic `console.log` lines removed (or clearly marked
      `// DEBUG:` with a cleanup ticket)

## Common pitfalls (learned the hard way)

### PWA ↔ extension handoff

- The extension saves captures to its own IDB, then the PWA
  transfers them via `transferAllFromExtension` into local storage.
- **Every field in `ImageRecord` must be explicitly carried through
  the transfer call**. Missing one (e.g. `pageMetadata`) silently
  drops that data. History: April 2026 — DOM metadata was lost
  between extension → PWA because the transfer call didn't pass it.

### Content script re-injection

- `chrome.scripting.executeScript({ files: ["content.js"] })` runs
  the file in the existing page realm. Top-level `let` / `const`
  throw on second injection.
- Fix: the content script is wrapped in an IIFE at build time
  (see `packages/extension/vite.config.ts` —
  `iifeWrapContentScript` plugin). Don't remove it.

### Capture timing

- Hide-for-capture (scrollbar suppression, sticky UI hiding) must
  complete a paint before the screenshot fires. The current delay
  constant is `POST_HIDE_PAINT_MS` in the service worker. If you see
  scrollbars or overlays in captures that shouldn't be there, this
  is the knob.

### Visibility detection (DOM metadata)

- Use `Element.checkVisibility({ checkOpacity, checkVisibilityCSS,
  contentVisibilityAuto })` — it walks the ancestor chain and catches
  hover-menu-hidden elements the own-element style check misses.
- `aria-hidden` on ANCESTORS is deliberately NOT checked — decorative
  wrappers use it and over-filter kills valid interactive elements.
  Only the element's OWN `aria-hidden` is honored.

### Right-click context menu

- Canvas right-click is mode-switching: hits an annotation → selection
  action menu; empty canvas → toolbox menu (mirrors the toolbar 1:1).
- Menu items with `submenu` + `action` behave as split-buttons:
  left-click runs action, hover opens submenu. This matches the
  toolbar button + flyout chip pattern intentionally.

## Pending work / known plans

Active plans live in [`docs/plans/`](./docs/plans/) and are tracked
in that directory's [`README.md`](./docs/plans/README.md). Each plan
is self-contained so Claude Code can resume work from the file alone
after a context reset.

Current active plan:

- [`docs/plans/path-based-storage.md`](./docs/plans/path-based-storage.md)
  — drop numeric IDs in favor of filesystem-style paths. **Prerequisite
  for GitHubStore** (numeric IDs don't map to git objects).
- [`docs/plans/google-drive-integration.md`](./docs/plans/google-drive-integration.md)
  — rework Drive onto `drive.file` scope + Workspace Marketplace
  + Drive UI Integration. Phase 1 landed; Phases 2–4 gated on
  company incorporation.
- [`docs/plans/github-integration.md`](./docs/plans/github-integration.md)
  — individual-user `GitHubStore`: device-flow auth, repo +
  branch + base path picker, commits as save. Drive-equivalent
  scope. PR automation / Check Runs live in `annot-cloud`.
- [`docs/plans/oss-cloud-split.md`](./docs/plans/oss-cloud-split.md)
  — **read this before adding commercial-only behaviour**. Strategic
  plan for running OSS `ingcreators/annot` alongside a private
  `ingcreators/annot-cloud` once paid features enter scope.
  Guardrails apply today.

Queued work without a formal plan doc yet:

- **Element snap integration.** Next step after the DOM metadata
  sidebar: let the user right-click an element on the canvas and
  insert a rect / counter / callout fitted to the clicked DOM
  element. Hooks into the existing context-menu infrastructure.
- **Headless annotator prototype.** One-week spike validating that
  core's SVG generation can run in Node (`resvg-js` or similar).
  Blocks the Playwright integration; promotes a large chunk of P2
  (DOM-independence) from principle to requirement.

## Things to leave alone unless explicitly asked

- The IIFE wrapper for the content script build
- `POST_HIDE_PAINT_MS` and the capture-timing constants
- The `data-annot-version` attribute once set (bump, don't remove)
- `brand/` — shared brand assets, regenerate via `render-previews.mjs`
  only when brand changes

## When in doubt

- Consult `PRODUCT_DIRECTION.md` first.
- Ask the user — in Japanese — before invasive refactors or new
  dependencies.
- Small, reversible changes preferred over large PRs.
- No destructive git operations (force-push, reset --hard, branch -D)
  without explicit confirmation.
