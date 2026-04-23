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

Two entry points, both stable:

- **`@ingcreators/annot-core`** (root `index.ts`) — **full surface**,
  including browser-only UI. Imported by the PWA, extension,
  desktop host. Use this from browser-targeted packages.
- **`@ingcreators/annot-core/headless`** (`headless.ts`) — **DOM-free
  subset**, guaranteed to not pull in `document` / `window` /
  `navigator`. Imported by the future `@ingcreators/annot-annotator`,
  Playwright fixture, GitHub Action. Only covers storage types,
  path utilities, SVG format versioning, pure constants, ZIP
  builder, and a few pure helpers (dash utils, id).

Additional subpaths (`./editor`, `./storage`, `./utils`, `./encode`,
`./xmp`, `./zip`) remain for internal use; most external callers
should stick to the two top entries.

Rules when adding public symbols:

- New DOM-free symbols → export from BOTH `src/index.ts` and
  `src/headless.ts`.
- New DOM-dependent symbols → export from `src/index.ts` only.
- Don't add per-file `export *` barrels that mix DOM / non-DOM
  without clear sections.
- Internal helpers stay inside their module without root-level
  re-export.

### 6. Reply and commit language

- Replies to the user: **Japanese**.
- Code, comments, commit messages, PR descriptions: **English**.
- When in doubt, match the language of surrounding text in the file
  being edited.

## Pre-landing checklist for new features

Before declaring a feature done:

- [ ] `pnpm --filter <pkg> typecheck` passes
- [ ] `pnpm --filter <pkg> build` passes
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
