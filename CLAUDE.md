# CLAUDE.md — Working notes for Claude Code

> This file orients Claude Code (and any future AI assistant) for work
> in this repository. Read this before making non-trivial changes.
> The authoritative product direction lives in
> [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md); this file is the
> operational companion.

## TL;DR

- **Annot** is a screenshot annotation tool (PWA + Chrome extension +
  Electron desktop), built on a shared SVG-first core.
- The **strategic direction** is to extract that core as a headless
  library usable from Playwright / Node and integrate it tightly with
  GitHub. See [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md).
- **Code comments are in English**; user-facing UI strings are
  English-only (the PWA has no i18n infrastructure — see PR #913,
  "English-only user-facing surfaces"). Repository-wide commits /
  comments use English.
- The user works in Japanese. **Reply to the user in Japanese** unless
  they switch to English. Code, comments, docs, commit messages: English.

## Map of documentation

| File | Role |
|------|------|
| [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md) | Strategic north star + principles |
| [`CLAUDE.md`](./CLAUDE.md) (this file) | Operational guidance for Claude Code |
| [`docs/svg-format.md`](./docs/svg-format.md) | Canonical SVG annotation format reference |
| [`docs/url-schemes.md`](./docs/url-schemes.md) | Web routes + reserved `annot://` scheme |
| [`docs/design-system.md`](./docs/design-system.md) | Design tokens, theme switching, user-override API |
| [`docs/plugin-api/icons.md`](./docs/plugin-api/icons.md) | Plugin-author guide for `IconSpec` + the host icon registry |
| [`docs/ai-agents.md`](./docs/ai-agents.md) | Driving Annot from an AI agent via the `@ingcreators/annot-mcp` MCP server |
| [`docs/plans/`](./docs/plans/) | Queued / in-progress design plans |

## Monorepo layout

```
packages/
  core/         Editor core — SVG tools, PPTX export, storage types.
                Imported by every host. This is the future
                "headless annotator" boundary.
                npm name: @ingcreators/annot-core
  editor/       Tier C primitives (CanvasManager, SelectionManager,
                History, PropertyPanel, ToolBase). Browser-only.
                npm name: @ingcreators/annot-editor
  render/       Tier C-render. Data-driven `ImageRecord`
                rasterisation + the shared OOXML DrawingML builder.
                npm name: @ingcreators/annot-render
  host-ui/ Host-neutral editor surface — toolbar, drawer,
                right-panel, scratchpad UI, file-details, the
                <annot-*> Lit components, the lit.ts re-export,
                the UISection types, the EditorShell per-image
                lifecycle. Hosts (web, vscode, future desktop)
                consume it via `import { EditorShell, ... } from
                "@ingcreators/annot-host-ui"`.
                npm name: @ingcreators/annot-host-ui
  web/          PWA host. Owns routing, storage impls, right panel
                (mounts host-ui components).
                npm name: @ingcreators/annot-web
  vscode/       VSCode extension host. Custom editor for
                `*.annot.{svg,png,jpeg,jpg}` files; webview hosts
                an EditorShell against `vscode.workspace.fs`-backed
                VSCodeStore.
                npm name: @ingcreators/annot-vscode
  extension/    Chrome MV3 extension. Capture pipeline + offscreen
                encode + content-script DOM metadata.
                npm name: @ingcreators/annot-extension
  desktop/      Electron desktop host. Mounts the unified
                `<annot-file-manager-shell>` (from
                `@ingcreators/annot-web/gallery`) against
                `DesktopStore` — a `StorageProvider` backed by a
                filesystem library at `<userData>/library/` with
                per-file XMP metadata (mirrors `DeviceStore`'s
                model). The Electron main process lives in
                `src-electron/`. See
                `docs/plans/_done/desktop-storage-provider-migration.md`
                and
                `docs/plans/_done/desktop-electron-migration.md`.
                npm name: @ingcreators/annot-desktop
  annotator/    Headless annotator — Node-side `renderImageRecord`
                replacement built on `@resvg/resvg-js`. Tier A
                (pure Node, no DOM). Public API
                `createAnnotator(options) → { toPng, toSvg }` over
                an `ImageRecord`-shaped input. Tier-A SVG sanitiser
                (`@xmldom/xmldom`) strips editor-internal artefacts
                (`<style data-annot-fonts>`, legacy
                base-image-in-wrapper, `#ui-overlay`,
                `<g id="annotations">` wrapper). Published to npm
                (Phase 3 of the headless-annotator track flipped it
                from `private: true` — see
                `docs/plans/_done/headless-annotator-publish.md`).
                Phase 0 spike landed via
                `docs/plans/_done/headless-annotator-spike.md`;
                Phase 1 public API via
                `docs/plans/_done/annot-annotator-package.md`.
                npm name: @ingcreators/annot-annotator
                (published 2026-05-19; current 0.6.0)
  playwright/   Playwright fixture composing `annot-annotator` into
                idiomatic `test.extend({ annotator })` form +
                shipping the canonical `page.screenshot({ annot:
                { … } })` prototype patch. Callers `import { test,
                expect, rectForBoundingBox } from
                "@ingcreators/annot-playwright"` and gain both
                `annotator.annotateScreenshot(page, { … })` AND
                `page.screenshot({ annot: { overlays, tags,
                editable } })` / `locator.screenshot({ annot: { … }
                })`. The patch falls through byte-for-byte when
                `annot` is absent, so Playwright Codegen output
                works unedited. Dimensions read from PNG IHDR so
                clipped + full-page captures both work.
                `@playwright/test` declared as `peerDependencies`.
                The generic patch is extensible via the
                `annotSourceResolvers` module-level registry —
                downstream packages (`@ingcreators/annot-product-docs`
                for MDX, hypothetical Figma / Sentry adapters)
                push resolvers that claim extra `annot.*` fields
                via `prepare()` (pre-screenshot side effects) +
                `resolveAnnotations(dims)` (post-screenshot
                page-space annotations). Three pure SVG-fragment
                helpers (`rectForBoundingBox` / `arrowBetween` /
                `textAt`) composable via string concatenation.
                Tier C (Playwright runtime); helpers are Tier A.
                See `docs/plans/_done/annot-playwright-fixture.md`
                + `docs/plans/_done/playwright-screenshot-fixture-relayer.md`.
                npm name: @ingcreators/annot-playwright
                (published 2026-05-19; current 0.4.2)
  mcp/          Model Context Protocol stdio server exposing the
                headless annotator as agent-callable tools. Nine
                tools at current: the five annotation /
                comparison tools (`annot_annotate_screenshot` +
                `annot_annotate_url`; `annot_redact_screenshot` +
                `annot_redact_url`; `annot_compare_screenshots`)
                plus `annot_aria_snapshot` (Playwright AI-mode
                snapshot) plus the three living-product-docs
                flow tools (`annot_draft_screen_spec` /
                `annot_propose_drift_fixes` /
                `annot_translate_screen_spec`). Locator-flavour
                DSL accepts Playwright locator strings
                (`button:has-text("...")`,
                `[data-testid="..."]`, `role=…`); resolution
                rules for non-rect shapes live in
                `src/browser/resolve-locator.ts`. Refcounted
                `BrowserPool` with 30 s idle close. Tier A
                (Node-only, no DOM). PPTX export deferred
                indefinitely pending the pptx-export
                `ImageRecord[]`-driven refactor noted under
                "Tier C-render" in section 2. See
                `docs/plans/_done/agent-mcp-integration.md` for
                the original 1-5 tool surface and
                `docs/plans/_done/living-product-docs.md` Phase 5
                for the docs-flow tools.
                npm name: @ingcreators/annot-mcp
                (published 2026-05-20; current 0.3.3)
  product-docs/ Living product docs core. Tier A — MDX parser
                (`parseMdx` / `parseMdxFile` on remark + unified
                + remark-mdx) for `.mdx` files with `annot:`
                frontmatter; match resolver (`parseSnapshot` /
                `resolveMatch`) for Playwright aria-snapshot
                YAML honouring `match.under` disambiguation;
                Playwright `productDocs` fixture
                (`productDocs.sync({ id, mdxPath })`) that
                re-syncs `annot:snapshot` + `annot:attributes`
                comment blocks in place via the byte-stable
                `updateCommentBlocks` rewriter (old `screen` /
                `capture` / `captureScreen` names kept as
                deprecated back-compat aliases since Phase 3 of
                `_done/playwright-screenshot-fixture-relayer.md`);
                MDX-aware resolver registered into annot-playwright's
                `annotSourceResolvers` registry so `page.screenshot({
                annot: { mdx: { id, path } } })` bundles the
                refresh-MDX + screenshot + bake + write pipeline
                into one call; drift detector (`detectDrift` /
                `detectDriftFromYaml`) emitting six finding kinds
                (added / removed / renamed / role-changed /
                duplicated / attribute-drift) with severity-bucket
                exit-code logic; `annot docs` CLI (`init` / `sync`
                / `lint`) with `--ci` / `--json` / `--fix` flags
                + sample GitHub Actions workflow that converts
                drift JSON into per-line `core.warning`
                annotations on the PR diff view. See
                `docs/plans/_done/living-product-docs.md` for the
                base design + `docs/plans/_done/playwright-screenshot-fixture-relayer.md`
                for the MDX hook + rename.
                npm name: @ingcreators/annot-product-docs
                (published 2026-05-21; current 0.4.1)
  product-docs-astro/ Astro 5.x / 6.x integration for the docs
                core. Tier B-render — `productDocsIntegration()`
                factory consumers drop into `astro.config.mjs`;
                seven `.astro` components (`<Screen>` /
                `<Overlay>` / `<Transition>` /
                `<TransitionTable>` / `<HistoryEntry>` /
                `<ScreenList>` / `<TransitionGraph>`) shipped as
                source under `./components/*.astro` exports;
                Image Service (`renderAnnotatedScreen` +
                SHA-keyed `createFileCache` /
                `createMemoryCache`) that composes the base
                screenshot with overlay callouts at build time
                using stored `[box=x,y,w,h]` markers from the
                fixture's `ariaSnapshot({ boxes: true })`
                output. Falls back to the base PNG verbatim
                when the snapshot lacks bbox data — the docs
                site still builds before the Playwright tour
                has run. The `/playwright` subpath that
                previously housed the screenshot fixture is now
                a deprecated re-export (Phase 4 of
                `_done/playwright-screenshot-fixture-relayer.md`)
                pointing at `@ingcreators/annot-product-docs`
                + `@ingcreators/annot-playwright`; it emits a
                `DeprecationWarning` at import time and will be
                removed in 0.5.0. `@playwright/test` is no
                longer a peer dep. See
                `docs/plans/_done/living-product-docs.md` Phase 2
                + `docs/plans/_done/playwright-screenshot-fixture-relayer.md`.
                npm name: @ingcreators/annot-product-docs-astro
                (published 2026-05-21; current 0.4.0)
  product-docs-xlsx/ Excel adapter for the docs core. Tier A —
                walks MDX bundles, dispatches per `xlsx.role`
                to the default no-template layout (cover /
                history / list / screen / reference Japanese-
                friendly defaults) OR the customer-template
                path that clones a configured `templateSheets[role]`
                sheet per bundle + substitutes `{var}` /
                `{meta.<name>}` / `{annot:date}` / `{var:format}`
                placeholders + writes `annot*`-prefixed Excel
                Named Ranges (`annotImage` /
                `annotImage_<screenId>` / `annotItemTable` /
                `annotHistory` / `annotList` / `annotSnapshot` /
                `annotAttributes`). `annot-docs-xlsx render
                --book <name>` CLI walks the docs root, groups
                by `xlsx.book`, picks template-vs-default per
                book config, and writes one `<book>.xlsx` per
                group. Targets the corporate screen-specifications use
                case where customers expect a specific
                corporate Excel template populated from a
                code-driven source of truth. See
                `docs/plans/_done/living-product-docs.md`
                Phase 3.
                npm name: @ingcreators/annot-product-docs-xlsx
                (published 2026-05-21; current 0.2.3)
  marketing/    Astro 6 marketing site serving `annot.work/`.
                Hero + features + install row + second-hero
                MDX-snippet positioning landed in Phase 4 of
                `docs/plans/_done/annot-work-astro-unification.md`
                (PR #907).
                npm name: @ingcreators/annot-marketing
  docs-site/    Astro Starlight docs site serving
                `annot.work/docs/*`. Took over the conventional
                `docs-site/` directory + `@ingcreators/annot-docs-site`
                npm name in Phase 7 of
                `docs/plans/_done/annot-work-astro-unification.md`,
                then claimed the production route directly when
                the VitePress sibling was deleted in the
                "retire VitePress + English-only" follow-up.
                Consumes `@ingcreators/annot-product-docs` +
                `-astro` as workspace deps for the Phase 5
                dogfooded `/docs/app/` page (Playwright tour at
                `tests/docs/annot-app.spec.ts`; advisory GitHub
                Actions workflow at `.github/workflows/docs-tour.yml`).
                npm name: @ingcreators/annot-docs-site
  capture/      Shared capture-pipeline logic. The MAIN-world
                `walkElementTree` (`src/content/element-tree-walker.ts`)
                the extension host injects, plus the capture-prep
                helpers. See "DOM metadata collection runs in MAIN
                world" below. Private (workspace-only).
                npm name: @ingcreators/annot-capture
  doc/          Card / HTML-document core. `injectDocumentStyles`
                (`src/inject-styles.ts`) + the structural-vs-themable
                CSS split + the `Theme` registry / `@ingcreators/annot-doc/headless`
                theme types (see guardrail §11), plus document
                parsing (`parse.ts`). Private (workspace-only).
                npm name: @ingcreators/annot-doc
  embed-protocol/ Tier A embed-editor protocol. `EmbedMode` /
                `EmbedEvent` types, `encodeEmbedRequestUrl` /
                `parseEmbedRequestUrl`, `encodeEmbedReturnHash` /
                `parseEmbedReturnHash`, `createEmbedHostMessenger`
                (consumer) / `createEmbedClientMessenger` (producer)
                — origin-validated postMessage. Shared by the
                docs-site `<AnnotEditButton>` + the Worker's `/embed`
                shell (living-spec Phase 5 / annot-cloud 5y).
                npm name: @ingcreators/annot-embed-protocol
  cloud-store/  `AnnotCloudStore` — the `StorageProvider` for Annot
                Cloud, proxying image / document / folder reads +
                writes to the Worker's `/api/*` endpoints (cookie
                auth). Mounted by the PWA when signed in to
                `annot.work`. Private (workspace-only).
                npm name: @ingcreators/annot-cloud-store
  worker/       Cloudflare Worker serving `annot.work/api/*` (Hono).
                GitHub + Google OAuth, KV sessions, multi-tenant D1
                (`users` / `workspaces` / `images` / `documents` /
                `share_links` / `github_installations`), R2 object
                storage, share + embed endpoints, and the GitHub App
                embed round-trip (`src/embed/`: load / commit /
                webhook / setup — living-spec 5y / 5z). D1 migrations
                in `migrations/`; deploy + migration-apply run from
                `.github/workflows/{deploy,apply-migrations}.yml`.
                Private (workspace-only).
                npm name: @ingcreators/annot-worker
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

### 2. Three-tier package boundary (DOM independence in `core`)

The `three-package-split` plan replaced the old "editor UI in
core may use DOM APIs" carve-out with a real three-tier split.
Match the file's home to its runtime requirements:

| Tier | Package | Runtime | Examples |
|------|---------|---------|----------|
| A | `@ingcreators/annot-core` (root + subpaths) | pure Node | SVG format constants, storage types, path utilities, ZIP builder, capability predicates |
| B | `@ingcreators/annot-core/editor` subpath | jsdom-friendly Element manipulation, no `<canvas>` | `arrow-markers`, `transform-utils`, `shape-utils`, `text-utils`, `gradient-utils`, `tool-options` types, svg-format, toolbar-icons |
| C | `@ingcreators/annot-editor` | real browser (live SVG, pointer events, ResizeObserver, MutationObserver) | `CanvasManager`, `SelectionManager`, `PropertyPanel`, `ToolBase` + concrete tools, `History`, save/copy/download helpers, leaf widgets (tooltip, theme-toggle, custom-select, anchored-popover, color-palette, canvas-context-menu), `redact-utils`, `pptx-export`, the CanvasManager-coupled side of `export.ts` |
| C-render | `@ingcreators/annot-editor`'s sibling `@ingcreators/annot-render` | `<canvas>` rasterisation, no live editor session | `renderImageRecord` (data-driven `ImageRecord` → bitmap; future home for gallery bulk-export and the eventual `pptx-export` ImageRecord refactor) |

Dependency direction: `annot-render → annot-core` and
`annot-editor → annot-core`. **`annot-core` MUST NOT depend on
either** — circular package dependency. Likewise
`annot-render` MUST NOT depend on `annot-editor` (the split
exists so storage backends and gallery bulk-export can pull
rendering without dragging in the live editor).

Both invariants are CI-enforced by
`packages/core/src/headless.test.ts` (walks
`require.cache` after importing every documented `annot-core`
subpath; fails if any cached entry resolves under
`packages/editor/` or `packages/render/`).

When adding new code, ask: "does my function need a live
browser?" — yes → `annot-editor`. "Does it need `<canvas>`?" —
yes → `annot-editor` if also CanvasManager-coupled,
`annot-render` if data-driven. "Just SVG element manipulation,
works under jsdom?" — `annot-core/editor` (Tier B). "No DOM
references at all?" — `annot-core` root.

### 3. StorageProvider is the only way in

- Never `import { LocalStore } from "..."` in feature code. Use
  the `StorageProvider` dependency injected at boot.
- New storage methods are **optional on the interface**, and feature
  code checks `if (store.method)` before calling.
- Schema for paths / names follows the plan in
  [`docs/plans/path-based-storage.md`](./docs/plans/path-based-storage.md)
  (queued).

### 4. ElementTree schema is additive-only

- Location: `packages/core/src/element-tree/types.ts`
  (`ElementTree`, `ElementNode`, `BBox`). Wire format spec:
  [`docs/element-tree.md`](./docs/element-tree.md).
- OK: add optional fields, add optional sub-objects.
- NOT OK: rename existing fields, change the semantics of a field,
  remove a field.
- Future-proofing: Playwright integration may eventually populate a
  per-node `locator?: string` field. Treat that name as reserved.

### 5. Public API of `@ingcreators/annot-core` / `-editor` / `-render`

**The `annot-core` root entry is headless by construction.**
`src/index.ts` just `export * from "./headless.js"` — the two
are indistinguishable. Editor UI lives in `@ingcreators/annot-editor`,
data-driven rendering lives in `@ingcreators/annot-render`,
and the matching package layout reflects the three-tier model
in section 2 above.

| Subpath | Surface |
|---------|---------|
| `@ingcreators/annot-core` (or `/headless`) | Tier A. DOM-free: SVG format versioning, storage types, path utilities, capability predicates, dash utils, constants, id, assertNonNull, ZIP builder. **Importable in pure Node.** |
| `@ingcreators/annot-core/editor` | Tier B. jsdom-friendly element-taking helpers: `arrow-markers`, `transform-utils`, `shape-utils`, `text-utils` (unified text-bearing shape skeleton — every text-carrying element is `<g data-type="shape" data-shape-kind="...">` with per-`<tspan>` formatting on bold / italic / underline / size / family / color), `rich-text-mapper` (contentEditable HTML ↔ `TextRun[]`), `gradient-utils`, `tool-options` types, svg-format, toolbar-icons. No `<canvas>`. |
| `@ingcreators/annot-core/storage` | Tier A. Storage value types (`ImageRecord`, `FolderRecord`, `StorageProvider`). |
| `@ingcreators/annot-core/element-tree` | Tier A. Canonical screen-capture model (`ElementTree`, `ElementNode`, `BBox`) + YAML / JSON serializers + walk/find/flatten utilities. See [`docs/element-tree.md`](./docs/element-tree.md). |
| `@ingcreators/annot-core/utils` | Tier A. Pure utilities: `assertNonNull`, `computeDasharray`, `detectDashKey`, `newIdB58`, `DEFAULT_*` constants. |
| `@ingcreators/annot-core/xmp` | Browser-side. `createEditableImage` / `readEditableImage` round-trip. |
| `@ingcreators/annot-core/desktop-bridge` | Browser-side. Desktop-host IPC + `isDesktop` detection. Speaks Electron via `window.electronAPI.invoke` (Phase 9 of `_done/desktop-electron-migration.md` removed the Tauri sources + the dual-transport fallback). |
| `@ingcreators/annot-editor` | Tier C. `CanvasManager`, `SelectionManager`, `PropertyPanel`, `History`, `ToolBase`, the tool hierarchy, save/copy/download helpers (`saveToFile`, `getPngDataUrl`, `copyAsImage`, `saveAsEditableImage`, `exportSVGString`, `exportPptx`, `downloadAsImage`, …), leaf widgets (`setTooltip`, `createCustomSelect`, `createColorPalette`, `openAnchoredPopover`), context menu (`openCanvasContextMenu`). |
| `@ingcreators/annot-editor/<file>` | Per-file deep imports for editor internals (`tools/freehand-tool`, `property-controls`, etc.). Use sparingly. |
| `@ingcreators/annot-render` | Tier C-render. `renderImageRecord` plus the shared OOXML DrawingML builder (`buildShapeXml(shape, { ns: "a" \| "p", id })`, `buildDrawingXml`, `buildBackgroundPic`) used by both `pptx-export` (PPTX slides) and `toolbar.ts:#copyForOffice` (Office clipboard). Future home of gallery bulk-export. **Does NOT depend on `annot-editor`.** |

Rules when adding public symbols:

- New DOM-free symbols → export from `annot-core/src/headless.ts`.
  They flow into the root automatically via `export *`.
- New jsdom-friendly element-takers → `annot-core/src/editor/`
  (Tier B). Update `annot-core/src/editor/index.ts` if the
  symbol should be re-exported.
- New live-browser editor primitives → `annot-editor/src/` (Tier C).
- New data-driven `ImageRecord`-taking renderers / exporters →
  `annot-render/src/`. **Never** import from `annot-editor` here.
- New OOXML output for a tool (so it pastes correctly into
  PowerPoint AND exports correctly to PPTX) → one
  `transformOf` mapping in
  [`packages/core/src/editor/svg-to-annotation-shapes.ts`](./packages/core/src/editor/svg-to-annotation-shapes.ts)
  (Tier B) plus one per-shape builder under
  [`packages/render/src/drawingml/shapes/`](./packages/render/src/drawingml/shapes/).
  Both surfaces — the Office-clipboard path (`ns: "a"`) and the
  PPTX export path (`ns: "p"`) — pick the new shape up
  automatically. The Electron-side host
  (`packages/desktop/src-electron/ipc/clipboard.ts`) is
  packaging-only since
  [`_done/office-paste-shared-drawing-builder` phase 3](./docs/plans/_done/office-paste-shared-drawing-builder.md).
- The boundaries are CI-enforced by
  `packages/core/src/headless.test.ts`. Add a probe there if you
  introduce a new load-time global or a new package edge that
  could break the cycle invariant.

### 6. PropertyPanel is schema-driven

The right-side editor's PropertyPanel renders its controls from a
declarative registry (`PROPERTY_CONTROLS` in
[`packages/core/src/editor/property-schema.ts`](./packages/core/src/editor/property-schema.ts)),
not from a per-category imperative chain. When adding or editing a
property control:

- **New controls land in the registry first.** Add the id to
  `PROPERTY_CONTROL_IDS` (Tier B), the def to `PROPERTY_CONTROLS`,
  and a per-category entry in `CATEGORY_CONTROL_SHAPE`. Each def
  declares EXACTLY ONE of `setValue` (in-place attr write,
  Tier B), `replace` (element swap returning the new node,
  Tier B-friendly), or `effect: PropertyEffectId` (Tier C-only
  side effect — canvas pixel sampling, composite-`<g>` mutations,
  etc.). Visibility predicates (`visibleWhen`) act as ALL-targets
  gates so multi-select hides the control when any selected element
  fails the predicate.
- **Effect handlers live in PropertyPanel's constructor**
  (`packages/editor/src/property-panel.ts`). Each entry in
  `PROPERTY_EFFECT_IDS` maps to a closure that calls the matching
  Tier C helper (`applyArrowHead`, `convertRedactStyle`, etc.) and
  returns per-target replacements. Async handlers are awaited by
  the renderer before firing onCommit.
- **The renderer is in
  [`packages/editor/src/property-panel-renderer.ts`](./packages/editor/src/property-panel-renderer.ts).**
  `renderControl(def, targets, deps)` is a free function — it
  doesn't import `PropertyPanel`, so you can drive it from tests
  with a stub effect-handler table. A unified `dispatchMutation`
  helper routes `setValue` / `replace` / `effect` paths
  consistently across `color`, `number`, `select`, `variantPicker`
  control types.
- **PropertyPanel sections (Type / Fill / Line / Label) wrap the
  registry calls.** The registry doesn't model section grouping —
  the panel's per-category render method (`#renderShapeControls`,
  etc.) decides which controls go in which `#inSection` and may
  interleave imperative rows for behaviour the registry doesn't
  yet model (transparency sliders, cap type, per-end arrow
  type+size grids, marker bg-primitive controls).
- **DOM byte-equivalence is the migration contract.** When
  swapping an imperative `#addXxx` helper for a
  `#renderRegistryControl(id)` call, the rendered DOM must match
  the imperative output. The renderer's golden snapshots in
  [`packages/editor/src/property-panel-renderer.test.ts`](./packages/editor/src/property-panel-renderer.test.ts)
  pin the exact class names + attribute shapes — break them
  intentionally only when the migration is itself a deliberate
  visual change (called out in the PR description).

History: the schema-driven refactor landed across PRs #153–#161,
following [`docs/plans/_done/property-panel-schema.md`](./docs/plans/_done/property-panel-schema.md).

The toolbar applies the same imperative-chain → declarative-
registry pattern via `TOOL_REGISTRY` in
[`packages/core/src/editor/tool-registry.ts`](./packages/core/src/editor/tool-registry.ts):

- **One Tier B entry per tool** carries `id` / `label` / `icon`,
  the variant catalog (`variants` + `variantField` +
  `defaultVariant`), the persisted-fields list (`presetFields`),
  the element classifier (`variantKeyForElement`), and the rubber-
  band reader (`extractStyleFromElement`). Adding a new tool means
  one entry here + one entry in
  [`packages/web/src/editor/tool-factories.ts`](./packages/web/src/editor/tool-factories.ts)
  (Tier C, holds the `CanvasManager`-bound factory). `Toolbar`
  itself never changes.
- **Persistence is generic.** `presetToWire` / `presetFromWire`
  in [`packages/core/src/editor/tool-preset-serde.ts`](./packages/core/src/editor/tool-preset-serde.ts)
  walk `presetFields` and convert via the shared `FIELD_TO_SNAKE`
  table. Adding a new persisted attribute is one entry in the
  matching tool's `presetFields` — the file/localStorage/
  chrome.storage marshallers pick it up automatically.
- **Rubber-band is generic.** `Toolbar.syncPresetFromElement`
  runs the universal style reader (stroke / fill / dasharray /
  opacity / linecap / linejoin) and then dispatches to
  `TOOL_REGISTRY[toolId]?.extractStyleFromElement?.(el, preset)`
  for tool-specific reads. The per-tool `if (toolId === "...")`
  cascade is gone.
- **Variant write-back is generic too.** `applyPresetStyleAttrs`
  in [`packages/web/src/editor/toolbar-preset-helpers.ts`](./packages/web/src/editor/toolbar-preset-helpers.ts)
  walks `TOOL_REGISTRY` for the entry whose `variantKeyForElement`
  claims `el`, then routes to that entry's
  `applyStyleToElement(el, preset)`. Each tool's writer is the
  paired inverse of its `extractStyleFromElement` — when adding a
  new style field to a tool, edit BOTH callbacks; the
  `tool-registry.test.ts` symmetry test fails the build if one
  side is missing. Universal-style attrs (stroke / fill / cap /
  join / opacity / dasharray) flow through
  `writeUniversalStyleAttrs` in
  [`packages/core/src/editor/tool-style-writer.ts`](./packages/core/src/editor/tool-style-writer.ts);
  composite tools (marker bg primitive, textbox `<text>` child,
  arrow's `refreshArrowPath` regen) override and call the helper
  themselves.
- **Flyout / badge presentation is registry-driven.**
  `flyoutKind?: "variant" | "color"` on each `TOOL_REGISTRY` entry
  decides whether the variant flyout, the toolbar button's badge,
  and the canvas right-click toolbox menu present each variant as
  an icon glyph (default) or a filled color swatch. The optional
  `chipColorForVariant?: (variantValue) => string` resolves the
  swatch fill (Highlight uses identity since the variant value IS
  the hex), `tooltipLabelForVariant?: (value, label) => string`
  customises the tooltip text (Highlight maps palette hexes to
  "Yellow" / "Green" / … and ad-hoc hexes to empty for a no-parens
  fallback), and `ensurePresetForVariantChange?: (preset, value)
  => void` fixes up cross-field invariants on the preset after a
  flyout chip-pick (Highlight forces `shapeType="highlight"` so
  the underlying ShapeTool dispatches correctly). The structural
  test in [`packages/web/src/editor/toolbar.test.ts`](./packages/web/src/editor/toolbar.test.ts)
  guards the no-`toolId === "..."`-literal invariant in the
  toolbar render paths going forward — adding a new color-flyout
  tool is one entry in `TOOL_REGISTRY`, no `if (toolId ===
  "stamp")` chain in `toolbar.ts`.

History: PRs #166–#171 (toolbar schema), #193–#196 (write-back
symmetry), #197–TBD (flyoutKind discriminator), following
[`docs/plans/_done/toolbar-schema.md`](./docs/plans/_done/toolbar-schema.md),
[`docs/plans/_done/toolbar-apply-style-to-element.md`](./docs/plans/_done/toolbar-apply-style-to-element.md),
and
[`docs/plans/_done/toolbar-highlight-flyout-kind.md`](./docs/plans/_done/toolbar-highlight-flyout-kind.md).

The Tool-side property panel (the right panel users see when
they activate a drawing tool) applies the same pattern via
the optional `panelControls` field on each `TOOL_REGISTRY`
entry, with the schema-driven renderer in
[`packages/web/src/editor/tool-property-renderer.ts`](./packages/web/src/editor/tool-property-renderer.ts):

- **Per-tool control list lives in `panelControls`.** Each
  entry declares a `section` (`Type` / `Fill` / `Line` /
  `Label`) and an `id` — either a SELECTION-side
  `PropertyControlId` (`fillColor`, `strokeWidth`, …) or a
  Tool-only id from `ToolPanelExtraControlId` (`tool.typeChips`,
  `tool.transparencyPercent`, `tool.fillTransparencyPercent`,
  `tool.fillOpacityPercent`, `tool.freehandDone`). Optional
  `visibleWhen(preset)` predicate gates the row by current
  preset state (e.g. Redact's Color row only appears when
  `redactStyle === "solid"`).
- **Adapters bridge ids to preset mutations.**
  `TOOL_PANEL_ADAPTERS` in
  [`packages/core/src/editor/tool-panel-adapter.ts`](./packages/core/src/editor/tool-panel-adapter.ts)
  maps each id to a `(preset, value, toolId) => void` writer.
  The Tool side mutates a `ToolOptions` object instead of
  attributes on an `SVGElement`, but the option lists / labels
  / number ranges / `allowNone` flag come from the SELECTION
  registry via `selectionDefMetadata(id)` — ONE source of
  truth, so a UX edit to `PROPERTY_CONTROLS.strokeStyle.options`
  flows through to BOTH surfaces.
- **Per-tool overrides are explicit constants in the
  renderer**, not registry entries:
  `MARKER_STROKE_WIDTH_OVERRIDE` (counter borders cap at 20pt),
  `FONT_SIZE_TOOL_MAX.marker = 48` (counter numerals overflow
  past that), `FILL_COLOR_OVERRIDES` (shape uses "Fill" label,
  redact disables `allowNone`, each tool has its own fallback
  color when the preset is unset). Adding a new override is
  one entry in the matching constant + a one-line comment
  saying why the SELECTION baseline doesn't fit.
- **DOM byte-equivalence is the migration contract.** Goldens
  in
  [`packages/web/src/editor/tool-property-renderer.test.ts`](./packages/web/src/editor/tool-property-renderer.test.ts)
  pin every tool × variant combination via
  `toMatchInlineSnapshot()`. Edit the snapshots ONLY when the
  PR description calls out a deliberate visual change.

History: PRs #188–TBD, following
[`docs/plans/_done/tool-property-renderer-schema.md`](./docs/plans/_done/tool-property-renderer-schema.md).

### 7. Move bakes coordinates; transform carries rotation / flip only

Drag-move on every annotation kind writes the new position into
the children's geometry attrs (rect / image / text / foreignObject
`x` `y`; ellipse / circle `cx` `cy`; tspan `x` `y`; line / arrow
endpoints + arrow control point; path `d`; `<g data-type="shape">`
walks bg primitive + clipPath + tail anchors + tspans;
`<g data-marker>` walks bg primitive + numeral). The wrapper's
`transform` attribute is reserved for **rotation + flip** only —
no `transform="translate(...)"` and no `data-tx` / `data-ty` on
unrotated shapes.

Consequences:

- `el.getBBox()` returns the visual position for every unrotated
  shape. For rotated shapes it returns the **local pre-rotation**
  bounds; the `getWorldBBox` helper composes the rotation into
  an axis-aligned world bbox when callers need that.
- Saved SVG reads "what you see is the geometry" — no mental
  transform composition required when debugging captures, OOXML
  output, or extension transfers.
- The dispatcher lives in
  [`packages/core/src/editor/bake-translate.ts`](./packages/core/src/editor/bake-translate.ts);
  per-shape bakers live in
  [`text-utils.ts:bakeTextShapeTranslate`](./packages/core/src/editor/text-utils.ts)
  for sticky / callout / text-on-shape / textbox, the dispatcher
  itself for marker / path / group, and the existing
  `bakeLineTransform` for line / arrow.
- `selection.ts:#moveElement` routes the no-rotation / no-flip
  case through `bakeTranslate`. For rotated / flipped shapes
  the legacy `nudgeTranslate` (data-tx / ty + matrix emit) path
  stays in place — pivot tracking still needs both translate
  and rotate components in one matrix.

When adding a new annotation kind that lives in `<g>` or
`<path>`, plumb a per-shape baker into the dispatcher's switch
in `bake-translate.ts:bakeTranslate`. The
[`move-bakes-coordinates`](./docs/plans/_done/move-bakes-coordinates.md)
plan in `_done/` walks the design.

### 8. Font family is a logical token; OS resolves per script

The editor stores exactly three font-family tokens in
`data-font-family`: `Annot Sans`, `Annot Serif`, `Annot Mono`.
Resolution to actual typefaces is delegated:

- **CSS rendering** (live editor / saved SVG / PNG raster):
  the host's
  [`packages/core/styles/fonts.css`](./packages/core/styles/fonts.css)
  maps each token to an OS-aware family stack interleaving
  Latin / CJK / Arabic / Indic / Thai families so the
  browser's per-codepoint font selection lands on the OS
  native script font without any web-font download. The
  same stacks live in
  [`packages/core/src/editor/font-registry.ts`](./packages/core/src/editor/font-registry.ts)
  via `cssStackFor(token)` for code paths that need the
  string (PNG raster inlines it into the SVG `<defs><style>`
  so the file is self-contained).

- **OOXML** (PPTX export / Office paste): each token expands
  to a 3-typeface triple (`<a:latin>` + `<a:ea>` + `<a:cs>`)
  via `ooxmlTypefacesFor(token)`. PowerPoint applies per-
  codepoint Latin / East Asian / complex script fallback
  symmetrically. Standard Office typefaces (Calibri / Yu
  Gothic UI / Arial etc.) are chosen so cross-environment
  sharing without embedded fonts stays "good enough."

When reading a font-family value back from storage, ALWAYS
route through `coerceToLogicalFamily(s)` from the same file —
unknown / null / empty values normalise to `Annot Sans` so
downstream consumers always get a valid token. Pre-release:
legacy raw CSS family strings (`"sans-serif"`, `"system-ui,
..."`) get coerced silently on next save.

When adding new code that touches font-family:

- Editor pickers: pull the option list from `LOGICAL_FAMILIES`,
  not hard-coded strings. Read / write via `coerceToLogicalFamily`.
- PPTX text-run emit: route through `ooxmlTypefacesFor` so
  PowerPoint receives the triple (single `<a:latin>` is the
  legacy fallback for raw families, kept for back-compat with
  plugin-author overrides).
- Self-contained SVG output: use `injectLogicalFontStyles`
  (or call `cssStackFor` directly) to inline the rules so the
  exported file isn't dependent on the host's stylesheet
  being loaded.

The
[`multilingual-fonts-os-stack`](./docs/plans/_done/multilingual-fonts-os-stack.md)
plan in `_done/` walks the design and the per-OS family
choices.

### 9. Reply and commit language

- Replies to the user: **Japanese**.
- Code, comments, commit messages, PR descriptions: **English**.
- When in doubt, match the language of surrounding text in the file
  being edited.

### 10. Editor surface lives in `@ingcreators/annot-host-ui`

The host-neutral editor surface (per-image lifecycle, toolbar,
drawer, right-panel, scratchpad UI, file-details, the `<annot-*>`
Lit components, the `lit.ts` re-export, the `UISection` types,
the `<annot-icon>` Lit wrapper) lives in the
`@ingcreators/annot-host-ui` workspace package, not in
`packages/web/src/editor/`. Hosts (PWA, VSCode, future
desktop-direct, …) consume it via `import { EditorShell, ... }
from "@ingcreators/annot-host-ui"`.

**The shell mounts into a host-supplied `HTMLElement` and reads
/ writes through a host-supplied `StorageProvider`.** It MUST
NOT call `document.getElementById("svg-root")`,
`document.getElementById("canvas-container")`,
`document.getElementById("statusbar")`,
`document.getElementById("file-manager")`,
`document.getElementById("editor-sidebar")`,
`document.body.classList.add("editor-mode")`, or any other
PWA-shell DOM id. Those are host-shell concerns; they go in the
consumer (PWA's `EditorSession` etc.).

When adding new editor UI:

- New built-in Lit components → `packages/host-ui/src/`.
  They follow the same `annot-*` custom-element naming as
  before, the same hybrid-CSS migration stance, and the same
  Storybook coverage requirement (every LitElement under
  `host-ui/src/` ships at least one co-located
  `*.stories.ts`; the `packages/web/.storybook/main.ts`
  `stories` glob already covers
  `../../host-ui/src/**/*.stories.ts`).
- New tools (`ToolBase` subclasses) → `packages/host-ui/src/`
  (Tier C surface — they construct against `CanvasManager` which
  needs a real browser).
- Pure data / Tier A or Tier B helpers stay in
  `@ingcreators/annot-core`.
- Live-browser primitives (`CanvasManager`, `SelectionManager`,
  `History`, `PropertyPanel`, `ToolBase` itself) stay in
  `@ingcreators/annot-editor` — the shell composes them, doesn't
  duplicate them.

Boundary check: the CI invariant in
[`packages/host-ui/src/host-boundary.test.ts`](./packages/host-ui/src/host-boundary.test.ts)
exercises the host-ui surface under happy-dom with a
synthetic container and asserts no `document.getElementById`
call ever queries one of the PWA-shell DOM ids listed above.
Adding a new PWA-shell DOM id to the host-ui source breaks
the test — at which point the right move is either to inject
the value as a host parameter or to leave the call in the
consumer.

**PWA bootstrap path.** `EditorSession.setupEditor` boots the
canvas through `EditorShell.mountFromRecord`, not direct
`CanvasManager` / `History` / `SelectionManager` construction
(refactored by [`_done/editor-session-shell-switchover.md`](./docs/plans/_done/editor-session-shell-switchover.md)).
The PWA passes the index.html-shipped `<svg id="svg-root">`
via the shell's `svgRoot` host knob so first-render CSS still
hits the styled element before JS boots; the shell tags the
adopted SVG with `data-annot-shell-root="1"` so the attribute-
keyed CSS rules in
[`packages/core/styles/editor.css`](./packages/core/styles/editor.css)
apply alongside the existing `#svg-root` rules. The PWA-shell
orchestration the shell intentionally doesn't model
(file-details drawer, header, status bar, toolbar, right-panel,
scratchpad popover, keyboard-help install, body-class toggling)
stays in `EditorSession`.

History: [`_done/vscode-extension-host.md`](./docs/plans/_done/vscode-extension-host.md)
(PRs [#395](https://github.com/ingcreators/annot/pull/395)–#404),
followed by [`_done/editor-session-shell-switchover.md`](./docs/plans/_done/editor-session-shell-switchover.md)
(PRs #411–TBD).

### 11. Document themes — structural vs themable CSS split

`injectDocumentStyles` in
[`packages/doc/src/inject-styles.ts`](./packages/doc/src/inject-styles.ts)
emits the document's `<style>` block in two layers:

| Layer | Authored as | Emitted always? | Examples |
|------|-------------|-----------------|----------|
| **Structural** | Inline in `inject-styles.ts` | Yes | `[data-annot-block]` selectors, grid templates per `data-step-layout`, `position: relative` anchors, CSS counter declarations, print rules, mobile collapse rules, the structural `--annot-card-*` / `--annot-step-badge-*` geometry vars |
| **Theme** | `Theme` modules under [`packages/doc/src/themes/`](./packages/doc/src/themes/) | Per-document opt-in via `meta.appearance.template`; falls back to legacy `meta.theme` mapping for non-opted docs | `--annot-doc-*` / `--annot-card-*` / `--annot-step-badge-*` colour values, optional `darkVars`, optional theme-specific `extraCss` selectors, optional `badgeLabelTemplate` |

The split is a guardrail, not just a refactor:

- **Anything the editor's DOM walks for stays structural.**
  `<annot-doc-shell>` and the editor's slash-menu / drag-handle
  code identify blocks via `[data-annot-block]` selectors and
  position absolutely-positioned children via `position:
  relative` anchors. Moving any of those into a theme would
  let a theme accidentally break the editor.
- **Themes only touch presentation.** Colours, shadows, font
  scale, badge shape — all overridable per theme. Geometry
  (radius / padding / gap defaults) starts structural and
  moves to themable only when a built-in theme actually needs
  to override it (`minimal` overrode `--annot-card-radius`
  via `extraCss` rather than a `vars` move; the bytes for
  existing fixtures stay identical).
- **User customisation lands as a postlude**, not a structural
  edit. `meta.appearance.fontFamily` appends an override block
  after `extraCss`; `meta.appearance.customCss` appends a
  sanitised user block after that. Both are inert when not
  set (byte-identical for docs that haven't opted in).

When adding new doc CSS, the test is:

1. Does the editor's TypeScript code walk for this selector or
   attribute? → structural (inline in `inject-styles.ts`).
2. Is it purely visual (colour, shadow, radius)? → themable
   (move it into the `Theme` shape — `vars` + optionally
   `darkVars` + optionally `extraCss`).
3. Is it a one-off per-document override? → goes through the
   `meta.appearance.customCss` escape hatch; sanitiser strips
   `@import` / external `url()` / `behavior: url()`.

The `Theme` type + theme registry sit at
`@ingcreators/annot-doc/headless`; see
[`docs/plugin-api/themes.md`](./docs/plugin-api/themes.md) for
the plugin-author guide.

History: [`_done/card-document-themes.md`](./docs/plans/_done/card-document-themes.md)
(PRs [#632](https://github.com/ingcreators/annot/pull/632)–#637)
landed the split + the five built-in themes
(`modern-light` / `modern-dark` / `minimal` / `editorial` /
`playful`) + the Appearance picker + font-family override +
custom CSS escape hatch.

### 12. MetadataCache for cross-session + multi-tab consistency

The shared
[`MetadataCache`](./packages/core/src/storage/metadata-cache.ts)
(Tier A interface) +
[`IndexedDBMetadataCache`](./packages/host-ui/src/idb-metadata-cache.ts)
(Tier C impl) layer the per-store metadata-cache lifecycle the
same way
[`_done/unified-thumbnail-cache.md`](./docs/plans/_done/unified-thumbnail-cache.md)
layered thumbnail caching. Stores that opt in via
`StorageWithMetadataCache` (`metadataNamespace()` +
`attachMetadataCache(cache)`) get cross-session metadata
persistence + cross-tab consistency via `BroadcastChannel` for
free.

Caching policy is **lightweight fields only** — `ImageRecord.originalDataUrl`,
`ImageRecord.annotationsSvg`, and `DocumentRecord.bytes` are NOT
cached (sizes are MB-class; backends re-fetch on demand). The
cache holds title / dimensions / tags / timestamps / per-folder
listing arrays / per-namespace KV (e.g. GitHub branch HEAD SHA,
Drive Changes API page token) / path ↔ backend-id maps.

Opt-in status across the built-ins:

| Store | Opt-in | Bespoke cache fully replaced? | Notes |
|---|---|---|---|
| DeviceStore | ✓ | ✓ | `.annot.json` sidecar left on disk for downgrade; not read / written |
| DesktopStore | ✓ | ✓ | Same `.annot.json` policy |
| GitHubStore | ✓ | partial | `branchHead` tracking + cross-tab listener; full `GitHubTreeState` / `GitHubBlobCache` replacement deferred |
| GoogleDriveStore | ✓ | partial | `changesPageToken` seeded; full `#fileMeta` / `#recordCache` / id-map replacement deferred |
| BrowserStore | not applicable | n/a | Already IDB-native; second cache layer would be redundant |
| Extension `IDBStore` | not applicable | n/a | Already IDB-native |

When adding new code that touches metadata persistence:

- **Don't write a parallel in-memory map** when the same data
  can flow through `MetadataCache` — every additional cache is
  one more place to forget to invalidate.
- **Don't cache `originalDataUrl` / `annotationsSvg` /
  `DocumentRecord.bytes`** anywhere. The cache deliberately
  excludes them; sneaking them through a value field breaks the
  size guarantees for cross-session storage.
- **Don't construct your own `IndexedDBMetadataCache`** — the
  host owns one singleton per renderer; stores opt in via
  `attachMetadataCache`.
- **Don't bypass the namespace** —
  `MetadataCache` operations are scoped by namespace; cross-namespace
  side effects break multi-account isolation.

The plugin-author guide at
[`docs/plugin-api/metadata-cache.md`](./docs/plugin-api/metadata-cache.md)
documents the opt-in surface for third-party storage backends.

History: [`_done/shared-metadata-cache.md`](./docs/plans/_done/shared-metadata-cache.md)
(PRs [#667](https://github.com/ingcreators/annot/pull/667)–[#673](https://github.com/ingcreators/annot/pull/673))
landed the Tier A interface, Tier C implementation,
DeviceStore / DesktopStore migrations (full bespoke-cache
replacement), GitHubStore + GoogleDriveStore opt-ins
(additive — `branchHead` + Changes API foundations).

## Component stories (Storybook)

Storybook lives in
[`packages/web/.storybook/`](./packages/web/.storybook/) per
[`docs/plans/_done/storybook-introduction.md`](./docs/plans/_done/storybook-introduction.md).
Run locally with `pnpm --filter @ingcreators/annot-web storybook`.
**CI builds the static bundle on every PR and the build is
blocking** — a story that fails to compile fails the PR.

- **Stories are required for ALL built-in Lit components.**
  The `litelement-stories-coverage.md` follow-up (PRs
  #253–#256) closed the gap that `lit-migration-completion.md`
  left open: every `LitElement` subclass under
  `packages/web/src/` and `packages/host-ui/src/` ships at least
  one co-located `*.stories.ts`. As of 2026-07-04 there are **45
  LitElement components and 47 story files**, and every component
  has a co-located story (the last gap, `embed/embed-shell.ts`,
  was closed — its stories reproduce the loading + error states
  the visitor sees, since a successful mount needs a live
  `/api/embed/load` backend + real editor canvas). Adding a new
  built-in `LitElement` requires shipping at least a `Default`
  story in the same PR. Audit by matching stories to components
  **by path**, not by count — a `stories >= components` check
  passes even when a specific component is missing its story
  (some components ship multiple stories, padding the total).
- **Story authoring conventions.** Each story:
    - Lives next to the component (`foo.ts` →
      `foo.stories.ts`).
    - Sets `title:` to mirror the directory:
      `Editor / FooBar`, `Gallery / FooBar`,
      `UI / FooBar`, `Capture / FooBar`. Drawer + right-panel
      sections keep `Editor / DrawerSections / drawer.<id>`
      and `Editor / RightPanelSections / right-panel.<id>`.
    - Wraps the element in a host that mirrors the in-app
      context (panel background, fixed-width drawer,
      breadcrumb container, etc.). Components that use
      `display: contents` (e.g. `<annot-editor-header>`,
      `<annot-editor-statusbar>`, `<annot-file-manager-shell>`)
      need a wrapper with the production parent's flex
      layout.
    - Sets reactive properties imperatively after
      `document.createElement(...)` since most use
      `attribute: false`.
    - Adds `console.log("[story] <event>", …)` listeners for
      arg-flow tracing.
    - Exports named stories per visible state (`Default` /
      `Empty` / `Populated` / `Loading` / `Error` / etc.).
- **Vanilla (non-Lit) components don't need stories.**
  Opportunistic, not obligatory.
- **Stories are not test replacements.** Vitest stays the
  unit-test home; Storybook is the visual + interactive
  surface for reviewers + future plugin authors.

History: PRs [#236](https://github.com/ingcreators/annot/pull/236)
(Storybook CI blocking + 5/22 acknowledgement),
[#244–#251](https://github.com/ingcreators/annot/pull/244)
(`lit-migration-completion.md`'s six phases — ratio 12/27),
and [#253–#256](https://github.com/ingcreators/annot/pull/253)
(`litelement-stories-coverage.md`'s four phases — ratio
27/27 at the time, since grown to 45 components / 46 stories as
UI surfaces landed) shaped the current "required for all built-in"
stance. If broader visual-regression coverage becomes
valuable later (e.g. when Chromatic-style review lands per
Phase 3 of the Storybook plan), revisit this section as
part of that work.

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
- [ ] `pnpm lint` (Biome `check` — linter + formatter + import-sort
      assist) reports **0 findings**; CI blocks on this. Run
      `pnpm lint:fix` to apply every auto-fix in one shot, or
      `pnpm format` for formatter-only.
- [ ] `pnpm --filter <pkg> build` passes for every package whose
      source changed (CI builds core / web / extension; desktop is
      opt-in)
- [ ] If the SVG schema changed, `data-annot-version` is bumped and
      a note added to `docs/svg-format.md` (create if missing)
- [ ] If `StorageProvider` changed, all four existing implementations
      compile AND the change is marked optional for the future
      GitHubStore
- [ ] If `ElementTree` changed, the change is purely additive
      (no renames, no field removals)
- [ ] No new DOM dependencies introduced into `packages/core` outside
      of the editor UI layer
- [ ] Diagnostic `console.log` lines removed (or clearly marked
      `// DEBUG:` with a cleanup ticket)

## Common pitfalls (learned the hard way)

### PWA ↔ extension handoff

- The extension saves captures to its own IDB, then the PWA
  transfers them via `transferAllFromExtension` into local storage.
- **Every field in `ImageRecord` must be explicitly carried through
  the transfer call**. Missing one (e.g. `elementTree`) silently
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

- Use `Element.checkVisibility({ checkOpacity, checkVisibilityCSS })`
  — it walks the ancestor chain and catches hover-menu-hidden
  elements the own-element style check misses.
- `contentVisibilityAuto: true` is INTENTIONALLY OMITTED. The strict
  flag reports `content-visibility: auto` skipped descendants as not
  visible, which zeroes the Elements panel on common content sites
  (b.hatena.ne.jp / news feeds / infinite-scroll listings). The
  over-filter protection the original intent was about — overlays
  hidden via `visibility: hidden` / `opacity: 0` higher up the tree
  — still works through `checkVisibilityCSS: true` + `checkOpacity:
  true`. See PR #273 for the regression-driven removal.
- `aria-hidden` on ANCESTORS is deliberately NOT checked — decorative
  wrappers use it and over-filter kills valid interactive elements.
  Only the element's OWN `aria-hidden` is honored.

### DOM metadata collection runs in MAIN world

The walker that produces the `ElementTree` for the editor's
Elements panel — `walkElementTree` in
[`packages/capture/src/content/element-tree-walker.ts`](./packages/capture/src/content/element-tree-walker.ts)
— is injected by the extension host
([`packages/extension/src/background/host.ts`](./packages/extension/src/background/host.ts))
via `chrome.scripting.executeScript({ world: "MAIN" })`. The
function body is intentionally inlined and self-contained (no
module imports) because `executeScript({func})` cannot accept
closures or external references.

**Don't move this back into the isolated-world content script.**
Empirically (b.hatena.ne.jp/hotentry/it on Chrome 134), the
isolated world's `getBoundingClientRect()` returned 0×0 for every
descendant of `content-visibility: auto` cards even after
`captureVisibleTab` forced a paint and even with per-element bbox
pre-walks. The MAIN-world execution returns real bboxes on the
identical page state at the identical viewport. The exact Chrome
mechanism isn't documented; we paid for the duplication of walker
logic between content script and the inlined `func` to make it
work, and removed the content-script-side handler in this cleanup
PR. History: PRs #273 / #274 / #277 (failed isolated-world fixes)
+ #278 (MAIN-world rewrite).

### Capture-prep order: metadata after captureVisibleTab

In `captureVisible` / `captureArea` / `capturePages` /
`captureFullPage`, the metadata snapshot MUST happen AFTER
`chrome.tabs.captureVisibleTab` and BEFORE `endCapturePrep`:

  1. `captureVisibleTab` forces a paint of the visible viewport,
     committing layout for `content-visibility: auto` descendants
     currently on screen.
  2. Stickies are still hidden (haven't been restored by
     `endCapturePrep` yet). The `visibility: hidden` cascade
     filters out sticky-header / fixed-overlay descendants —
     exactly the elements absent from the screenshot pixels.
     Metadata's element list matches the screenshot 1:1.
  3. `endCapturePrep` then restores stickies.

If you find yourself wanting to take metadata BEFORE
`beginCapturePrep` (to avoid the sticky-cascade filtering),
reconsider — sticky-cascade IS the feature, not a bug. PR #272
made that mistake; #275 / #276 walked it back. History noted in
the PR comments.

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

Selected active plans worth knowing about (see
[`docs/plans/README.md`](./docs/plans/README.md) for the full
list with statuses):

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
- The redact tool's burn-in path
  ([`_done/redact-burn-into-image.md`](./docs/plans/_done/redact-burn-into-image.md)) —
  `EditorShell.applyAllRedactions` + `<annot-apply-redactions-button>`
  + the `<annot-dialog>`-backed `showConfirmDialog` confirmation are
  load-bearing for the privacy contract: redactions must be
  irreversible-after-save, AND the user must explicitly opt-in to
  irreversibility. Any "destroy the source bitmap" feature added later
  (e.g. a hypothetical "flatten all annotations") MUST go through the
  same destructive-confirmation pattern before mutating
  `ImageRecord.originalDataUrl`. The reverse — adding a silent /
  autosave-driven mutation of the underlying bitmap — would invert
  the contract this plan stood up.
- The crop tool's destructive bake path
  ([`_done/destructive-crop-bake.md`](./docs/plans/_done/destructive-crop-bake.md)) —
  `EditorShell.applyCrop` + the `Toolbar.options.applyCrop` →
  `ToolFactoryDeps.applyCrop` → `CropTool.onCropConfirmed` chain +
  `cropBitmap` (Tier C-render) + `bakeAnnotationsTranslate` (Tier B)
  follow the SAME destructive-mutation contract as redact-burn.
  Adding aspect-ratio locks / preset rectangles / per-element crop
  scope is fine; bypassing the confirmation dialog or the
  `storage.updateImage` persistence step (e.g. a "session-only
  zoom-and-look crop" wired through the same `applyCrop` slot)
  is not — that path silently mutates `originalDataUrl` and
  inverts the destructive-action opt-in.

## When in doubt

- Consult `PRODUCT_DIRECTION.md` first.
- Ask the user — in Japanese — before invasive refactors or new
  dependencies.
- Small, reversible changes preferred over large PRs.
- No destructive git operations (force-push, reset --hard, branch -D)
  without explicit confirmation.
