# Editor + Render package split

> **Status:** Done
> **Compatibility:** Introduces two new workspace packages,
>                    `@ingcreators/annot-editor` and
>                    `@ingcreators/annot-render`. No external
>                    API breakage (pre-release). Internal
>                    importers across web + extension + desktop
>                    migrate from `@ingcreators/annot-core/editor/...`
>                    to `@ingcreators/annot-editor/...` or
>                    `@ingcreators/annot-render/...` over the
>                    course of the migration. Headless boundary
>                    test (`packages/core/src/headless.test.ts`)
>                    keeps passing throughout.
> **Risk:** Phased over ~10 sub-PRs. Each phase ends on a green
>           CI; reverting any single phase rewinds the workspace
>           cleanly. The final cleanup phase (deletion of the
>           old `core/editor/` PWA-UI files after the moves) is
>           the only one with no upstream "back-out" path —
>           gated on prior phases having shipped without
>           regression.

## Context

The `pre-release-cleanup` plan delivered `@ingcreators/annot-core`
as a **headless-by-construction** root entry: importing
`@ingcreators/annot-core` from pure Node never reaches for
`document` / `window`. That is the API boundary. The
**physical layout** is still inconsistent:

- Pure SVG / storage code lives in `packages/core/src/{utils,storage,zip,...}/`
  — correct.
- Live-DOM PWA editor primitives (`CanvasManager`, `SelectionManager`,
  `PropertyPanel`, the tool hierarchy, `theme-toggle`, `tooltip`,
  `custom-select`, `anchored-popover`, `canvas-context-menu`,
  `color-palette`, `property-controls`, `smart-guides`) live in
  `packages/core/src/editor/`, even though they are PWA-only by
  any reasonable reading.
- Element-taking utility helpers (`transform-utils`, `history`,
  `arrow-markers`, `shape-utils`, `text-utils`, `redact-utils`,
  `gradient-utils`, `export`, `pptx-export`) sit alongside them.
  These are jsdom-runnable but not pure-Node — neither fully
  headless nor full PWA.

CLAUDE.md currently waves this through with "editor UI in core
can use DOM APIs — it's PWA-only." That made sense as a
transitional rule. With the API boundary now in place and the
headless annotator becoming a near-term goal (one of the next
queued initiatives in CLAUDE.md), this rule should retire and
the file tree should match the import path: PWA editor code
ships from a dedicated `@ingcreators/annot-editor` package, and
data-driven rendering ships from a sibling
`@ingcreators/annot-render` package.

### Why split editor and render

`packages/core/src/editor/export.ts` mixes two concerns:

- **CanvasManager-coupled** functions (`saveToFile`,
  `getPngDataUrl`, `copyAsImage`, `saveAsEditableImage`,
  `exportSVGString`, `exportExcelSVG`, `exportAnnotationsSvgForIdb`)
  operate on a live editor session — naturally editor-side.
- **`renderImageRecord(record)`** operates on a serialised
  `ImageRecord` (annotation SVG string + image data URL +
  metadata). Today it's used by three storage backends in
  `packages/web/src/storage/*` for thumbnail generation.
  Tomorrow it'll be the heart of gallery bulk-export
  (select N images → ZIP / multi-slide PPTX / etc.) per
  the product roadmap.

If we ship a single `annot-editor` package containing both,
the bulk-export / storage call sites would read:

```ts
import { renderImageRecord } from "@ingcreators/annot-editor";
```

That import line is dishonest — bulk-export and thumbnail
generation are not "editor" concerns. They're rendering
concerns that happen to use the same `<canvas>` rasterisation
machinery the editor's save flow uses.

Splitting the package surfaces the correct dependency:
storage backends and the future gallery bulk-export view
import `@ingcreators/annot-render`; only the live editor (and
its `toolbar-save-menu`) imports `@ingcreators/annot-editor`.

### Final layout reflects four audiences

| Audience | Reads from | Runtime |
|----------|-----------|---------|
| Headless annotator (Playwright fixture, GitHub Action) | `@ingcreators/annot-core` (+ optionally `@ingcreators/annot-core/editor` under jsdom) | pure Node, jsdom for Element-taking helpers |
| Server-side / batch render (e.g. headless thumbnail worker) | `@ingcreators/annot-render` (under jsdom + node-canvas, or future `resvg-js` swap-in) | jsdom + canvas, no live editor |
| Editor library consumer (`annot-cloud`, future plugins) | `@ingcreators/annot-editor` (+ `@ingcreators/annot-render`) | real browser |
| PWA / extension / desktop hosts | `@ingcreators/annot-web` (which depends on the three above) | real browser |

## Design

### Tier model

Three runtime tiers (one more than today's "headless vs not"):

- **Tier A — pure Node.** `@ingcreators/annot-core` root entry.
  Import never references `document` / `window` / `Element`
  even at the type level; everything is value types, pure
  functions, byte-array helpers. Today's `headless.test.ts`
  enforces this.

- **Tier B — jsdom-friendly Element-taking helpers.**
  `@ingcreators/annot-core/editor` subpath. Functions take an
  `SVGElement` / `Element` parameter and may call
  `document.createElementNS` etc. — they require a DOM
  implementation (jsdom satisfies this) but not a live
  browser. Headless annotator imports these under jsdom.
  No top-level DOM access (so the **import** still succeeds in
  pure Node; only the **call** requires a DOM).

- **Tier C — live-browser editor primitives.** New
  `@ingcreators/annot-editor` package. `CanvasManager`,
  `SelectionManager`, `PropertyPanel`, the tool hierarchy,
  pointer-event handling, ResizeObserver, MutationObserver,
  and every DOM-widget helper. Real browser only.

- **Tier C-render — data-driven rendering.** New
  `@ingcreators/annot-render` package. `renderImageRecord` and
  any future `ImageRecord`-taking exporter. Uses `<canvas>`,
  `Blob`, etc., but does NOT need a live editor session — it
  works from serialised `ImageRecord` data. Powers thumbnail
  generation in storage backends today; will power gallery
  bulk-export tomorrow. Could in principle run under jsdom +
  `node-canvas` for server-side batch rendering, though that
  isn't a goal of this plan.

(`@ingcreators/annot-web` continues to depend on all four tiers
for the PWA app shell. `annot-extension` and `annot-desktop`
likewise pick up Tier C / C-render through the editor and
render packages.)

### File assignments

**Stays in `@ingcreators/annot-core` (Tier A, no move)**

- All of `packages/core/src/storage/`
- All of `packages/core/src/utils/` (post-4-3 — already pure)
- All of `packages/core/src/zip/`, `encode/`, `xmp/`
- `packages/core/src/headless.ts` and root `index.ts`
- `packages/core/src/editor/svg-format.ts` — pure
- `packages/core/src/editor/toolbar-icons.ts` — pure SVG strings

**Stays in `@ingcreators/annot-core/editor` subpath (Tier B, no move)**

| File | DOM use |
|------|---------|
| `transform-utils.ts` | None — pure math |
| `history.ts` | `.innerHTML` getter (jsdom OK) |
| `arrow-markers.ts` | `document.createElementNS` (jsdom OK) |
| `shape-utils.ts` | `document.createElementNS` (jsdom OK) |
| `text-utils.ts` | `document.createElementNS` (jsdom OK) |
| `gradient-utils.ts` | `document.createElementNS` (jsdom OK) |

The `arrow-markers.ts` / `*-utils.ts` files are tagged "Tier B"
because the headless annotator wants to call them under jsdom
(they produce SVG nodes the annotator then serialises). Future
"headless annotator prototype" work may further refine — for
example, separating the pure SVG-string builders from the
DOM-element factory — but that is **not** in this plan.

**Moves to `@ingcreators/annot-editor` (Tier C, NEW package)**

| File | DOM use that disqualifies Tier B |
|------|----------------------------------|
| `canvas-manager.ts` | live SVG, ResizeObserver, MutationObserver, pointer events |
| `selection.ts` | pointer / keyboard gestures, live handle DOM |
| `selection-helpers.ts` | uses live `SVGSVGElement.getCTM()` etc. |
| `property-panel.ts` | full DOM panel construction |
| `property-panel-helpers.ts` | `HTMLElement` widget builders |
| `property-controls.ts` | DOM widgets, popovers |
| `tools/tool-base.ts` + each `tools/*-tool.ts` | pointer events, live SVG node creation |
| `smart-guides.ts` | live overlay DOM |
| `theme-toggle.ts` | DOM button |
| `tooltip.ts` | DOM tooltip mount/unmount |
| `custom-select.ts` | DOM popover |
| `anchored-popover.ts` | DOM popover |
| `canvas-context-menu.ts` | DOM context menu |
| `color-palette.ts` | DOM palette swatches |
| `redact-utils.ts` | `OffscreenCanvas` + `<canvas>` for mosaic / blur rasterisation |
| `export.ts` (most of it — see below) | `XMLSerializer` + `Blob` + `URL.createObjectURL` + canvas rasterisation |
| `pptx-export.ts` (today; see below) | `<canvas>` for slide-background rasterisation |

**Moves to `@ingcreators/annot-render` (Tier C-render, NEW package)**

| Symbol | Source | Reason |
|--------|--------|--------|
| `renderImageRecord` | split out of `export.ts` | takes `ImageRecord`, not `CanvasManager` — data-driven rasterisation, the seed of gallery bulk-export |

This is the only function that lands in `annot-render` on day 1.
The expectation is that gallery bulk-export work (out of scope
for this plan) will add new `ImageRecord`-taking exporters
(`exportZip`, `exportMultiSlidePptx`, etc.) that join here, and
that a follow-up refactor will lift the existing
CanvasManager-coupled `export.ts` / `pptx-export.ts` functions
to also accept `ImageRecord` and migrate to `annot-render`.
Until that refactor lands, those functions stay in
`annot-editor` because their TypeScript signatures require a
live `CanvasManager` instance the render package shouldn't
import.

**Note on `redact-utils`, `export.ts`, `pptx-export.ts`.** An
earlier draft of this plan kept these three in Tier B as
"DOM-ish helpers", citing a hypothetical circular import.
Tracing the actual dependency graph showed the concern was
unfounded — and a separate review surfaced that `export.ts`
splits cleanly between editor-side and render-side concerns
(see "Why split editor and render" above):

- `redact-utils` is consumed only by `property-panel.ts` and
  `tools/redact-tool.ts` — both Tier C. Lands in
  `annot-editor` alongside its consumers.
- `pptx-export.ts` is consumed only by
  `web/src/editor/toolbar-save-menu.ts` (already
  editor-side). Lands in `annot-editor` for now; a future
  refactor will rework it to take `ImageRecord` + a list of
  shapes (instead of a live `CanvasManager`) and migrate it
  to `annot-render` so gallery bulk-export can build
  multi-slide decks from selections.
- `export.ts` splits between the two new packages.
  `renderImageRecord` (data-driven) → `annot-render`;
  everything else (CanvasManager-coupled — `saveToFile`,
  `getPngDataUrl`, `copyAsImage`, `saveAsEditableImage`,
  `exportSVGString`, etc.) → `annot-editor`.

The benefit: Tier B becomes the honest definition
"jsdom-friendly Element manipulation, no `<canvas>`
rasterisation required" — exactly the surface a
headless-annotator (running under jsdom or `resvg-js`) wants
to reach for. And `annot-render` lands with the smallest
possible day-1 surface (one function), giving us the right
place to grow gallery bulk-export into without rerunning the
package-naming debate.

### Package layout (after the migration)

```
packages/
  core/                       # Tier A + Tier B
    package.json              # name: @ingcreators/annot-core
    src/
      headless.ts             # Tier A entry (root re-exports this)
      index.ts                # Tier A entry
      storage/                # Tier A
      utils/                  # Tier A
      zip/                    # Tier A
      encode/                 # Tier A
      xmp/                    # Tier A
      editor/                 # Tier B subpath
        index.ts              # re-exports svg-format + jsdom helpers
        svg-format.ts
        toolbar-icons.ts
        transform-utils.ts
        history.ts
        arrow-markers.ts
        shape-utils.ts
        text-utils.ts
        gradient-utils.ts

  editor/                     # Tier C — NEW
    package.json              # name: @ingcreators/annot-editor
    src/
      index.ts                # main entry
      canvas-manager.ts
      selection.ts
      selection-helpers.ts
      property-panel.ts
      property-panel-helpers.ts
      property-controls.ts
      smart-guides.ts
      theme-toggle.ts
      tooltip.ts
      custom-select.ts
      anchored-popover.ts
      canvas-context-menu.ts
      color-palette.ts
      redact-utils.ts
      export.ts                # CanvasManager-coupled save / copy / etc.
      pptx-export.ts           # CanvasManager-coupled today; future migration to render
      tools/
        tool-base.ts
        arrow-tool.ts
        crop-tool.ts
        freehand-tool.ts
        marker-tool.ts
        redact-tool.ts
        shape-tool.ts
        text-tool.ts

  render/                     # Tier C-render — NEW
    package.json              # name: @ingcreators/annot-render
    src/
      index.ts                # main entry
      render-image-record.ts  # `renderImageRecord(record)` — the day-1 surface

  web/                        # PWA shell (unchanged structure)
  extension/                  # MV3 extension (unchanged)
  desktop/                    # Tauri host (unchanged)
```

Dependency direction (top → bottom; nothing reads upward):

- `@ingcreators/annot-core` — depends on nothing in the
  workspace.
- `@ingcreators/annot-render` — depends on
  `@ingcreators/annot-core` (`ImageRecord` type from
  `/storage`, SVG-format constants from `/editor`).
  **Does NOT depend on `annot-editor`** — that's the whole
  point of splitting.
- `@ingcreators/annot-editor` — depends on
  `@ingcreators/annot-core` (Tier A + Tier B subpaths) and
  on `@ingcreators/annot-render` for the few places editor
  code today reaches `renderImageRecord` directly (mostly
  none — editor-side save uses CanvasManager-coupled
  functions that stay in `annot-editor`).
- `@ingcreators/annot-web` — adds `@ingcreators/annot-editor`
  and `@ingcreators/annot-render` to its dependencies.
  Storage backends (`packages/web/src/storage/*`) import
  `renderImageRecord` from `@ingcreators/annot-render`,
  not `@ingcreators/annot-editor`.
- `@ingcreators/annot-extension` already imports
  `@ingcreators/annot-web/editor/toolbar`; picks up editor +
  render transitively via web.
- `@ingcreators/annot-desktop` updates from
  `@ingcreators/annot-core/editor/canvas-manager` (etc.) to
  `@ingcreators/annot-editor`. (Desktop's gallery may also
  consume `@ingcreators/annot-render` directly when the
  bulk-export plan lands.)

## Phased plan

Each phase lands as its own PR. Each PR keeps the workspace
green (typecheck, tests, lint, builds). The original
`core/editor/<file>.ts` is deleted in the same PR that moves it
— **not** kept as a re-export shim, since this is a pre-release
window and the indirection would mask future drift.

### Phase ordering — top-down, not leaves-first

The Phase 0 implementation surfaced a real-world dependency cycle
risk that an earlier draft of this plan got backwards. Files like
`tooltip.ts`, `custom-select.ts`, and `color-palette.ts` look like
"leaves" of the dep graph from the **producer** side — they don't
import anything fancy. But from the **consumer** side they're
deeply depended-on by other Tier C files still living in
`core/editor/` (`property-panel`, `property-controls`,
`theme-toggle`, etc.).

If we move `tooltip.ts` to `annot-editor` while
`core/editor/property-panel.ts` still imports it, the property-panel
file would have to read:

```ts
import { setTooltip } from "@ingcreators/annot-editor/tooltip";
```

That's `annot-core → annot-editor` at the package level — a
circular import (`annot-editor` already depends on `annot-core`).
Bundlers and TypeScript would reject this immediately.

The correct order is **top-down**: move consumers BEFORE their
dependencies, so each phase only ever introduces an
`annot-editor → annot-core` edge (which is the legal direction).
A grep of `core/editor/` produced this consumer graph:

| File | Other core/editor files that import it |
|------|------------------------------------------|
| `canvas-context-menu` | (none) |
| `export.ts` | (none — only web) |
| `pptx-export.ts` | (none — only web) |
| `theme-toggle` | `index.ts` barrel only |
| `property-panel` | `index.ts` barrel only |
| `property-controls` | `property-panel` |
| `redact-utils` | `property-panel`, `tools/redact-tool` |
| `color-palette` | `property-controls` |
| `custom-select` | `property-controls`, `property-panel` |
| `anchored-popover` | `custom-select`, `property-controls` |
| `tooltip` | `color-palette`, `custom-select`, `property-controls`, `property-panel`, `theme-toggle` |
| `tools/*` | (intra-tool only; consumed by web `toolbar.ts` post-Phase 5) |
| `smart-guides` | `selection` |
| `selection` + `helpers` | (none — only web) |
| `history` | `selection` |
| `canvas-manager` | almost everything — keystone |

Sorted into levels (each level has zero remaining
core/editor consumers once prior levels have moved):

| Level | Files |
|-------|-------|
| 0 (no in-core consumers) | `canvas-context-menu`, `theme-toggle`, `property-panel`, `selection`, `smart-guides`, `tools/*` (consumed only by web), `export.ts`, `pptx-export.ts` |
| 1 (consumers all in level 0) | `property-controls`, `redact-utils`, `history` |
| 2 | `color-palette`, `custom-select` |
| 3 | `anchored-popover` |
| 4 | `tooltip` |
| 5 (keystone) | `canvas-manager` |

### Phased plan

| Phase | Scope | PR count |
|-------|-------|----------|
| **0** | ✅ DONE — both `@ingcreators/annot-editor` and `@ingcreators/annot-render` workspace packages scaffolded with empty placeholder entries. `pnpm install` + green CI. | 1 (landed in [#128](https://github.com/ingcreators/annot/pull/128)) |
| **1** | **Warm-up moves**: `canvas-context-menu.ts` (no in-core consumers — pattern validation) + `theme-toggle.ts` (consumer is just the editor barrel re-export, easy to update). Establishes the move-pattern this plan will repeat ~8 more times. | 1 |
| **2** | Move the **tool hierarchy**: `tools/tool-base.ts`, `tools/{shape,arrow,text,freehand,marker,redact,crop}-tool.ts`. Largest single move. Tools have no in-core consumers (the `core/editor/index.ts` barrel re-exports `ToolBase` / `ToolOptions` only — these get redirected to `annot-editor`). After this phase, `redact-utils`'s `tools/redact-tool` consumer is in annot-editor; only `property-panel` still consumes it from core. | 1 |
| **3** | Move **PropertyPanel cluster**: `property-panel.ts` + `property-panel-helpers.ts`. Only consumer in core is the editor barrel. After this, the leaf widgets (`tooltip`, `custom-select`, `color-palette`, `anchored-popover`, `redact-utils`) lose their last in-core consumer. | 1 |
| **4** | Move `property-controls.ts` + `redact-utils.ts` together. Both are now Level 1: their core consumers (`property-panel`, `tools/redact-tool`) have moved out. | 1 |
| **5** | Move **`smart-guides.ts`** + **`selection.ts`** + **`selection-helpers.ts`**. selection consumes smart-guides; both have no other in-core consumers. | 1 |
| **6** | Move **leaf widgets** in one batch: `color-palette.ts`, `custom-select.ts`, `anchored-popover.ts`, `tooltip.ts`. All Level 2–4. By now their core consumers have all moved to annot-editor, so the moves are now "safe leaves" — opposite of the original plan's framing. | 1 |
| **7** | Move **`History`**. Consumer was `selection` (already moved); it's now an isolated Tier C file in core. | 1 |
| **8** | **Keystone**: move `canvas-manager.ts` together with **`export.ts`** and **`pptx-export.ts`**. `canvas-manager.ts` and `pptx-export.ts` go to `annot-editor` (CanvasManager-coupled). `export.ts` is **split**: `renderImageRecord` (and its private helpers) → `annot-render`; the rest of `export.ts` (CanvasManager-coupled `saveToFile`, `getPngDataUrl`, `copyAsImage`, `saveAsEditableImage`, `exportSVGString`, `exportExcelSVG`, `exportAnnotationsSvgForIdb`, `copyAnnotationsAsImage`) → `annot-editor`. The three storage backends in `packages/web/src/storage/*` switch their `renderImageRecord` import to `@ingcreators/annot-render`. After this PR, `core/editor/` no longer holds any Tier C / C-render code. | 1 |
| **9** | **CLAUDE.md** + plan-doc updates: drop the "editor UI in core can use DOM APIs" carve-out from `Architectural guardrails 2`. Record the Tier A / B / C / C-render model in the public-API section. Mark this plan `Done`. | 1 |

After this plan lands, the **headless annotator prototype** item
in CLAUDE.md's pending-work list becomes actionable — that's a
separate plan, out of scope here.

### Cycle-prevention invariant (CI-enforced)

Phase 1 also extends `packages/core/src/headless.test.ts` with
an additional assertion: **no module under `packages/core/src/`
may transitively import `@ingcreators/annot-editor` or
`@ingcreators/annot-render`**. Implemented by walking
`require.cache` after the headless-import smoke runs and
checking no path matches those package names. This catches the
"oops, I added an editor-package import to a core file" case at
CI time, no human review needed.

## Verification

Per-phase pre-landing checklist (additions to the standard CLAUDE.md
checklist):

- [ ] `pnpm install` re-resolves the workspace without lockfile churn
      beyond the new package's own dependencies.
- [ ] `pnpm -r typecheck` — pass.
- [ ] `pnpm test` — 253+ pass (no regression in count).
- [ ] `pnpm --filter @ingcreators/annot-core build` — pass.
- [ ] `pnpm --filter @ingcreators/annot-editor build` — pass (after Phase 0).
- [ ] `pnpm --filter @ingcreators/annot-render build` — pass (after Phase 0).
- [ ] `pnpm --filter @ingcreators/annot-web build` — pass.
- [ ] `pnpm --filter @ingcreators/annot-extension build` — pass.
- [ ] `pnpm lint` — 0 findings.
- [ ] `headless.test.ts` continues to pass — boundary not regressed.
- [ ] CI green on the PR.

Stage-specific extras:

- **Phase 0:** confirm both new packages show up in `pnpm -r ls --depth=-1`. Confirm `@ingcreators/annot-render` does NOT depend on `@ingcreators/annot-editor` in its `package.json` (the dependency direction is render-side only — render never imports editor).
- **Phase 5 (tools):** spot-check each tool in the PWA — pick the
  Shape, Arrow, Text, and Marker tools, draw one annotation each,
  confirm save round-trips.
- **Phase 8 (canvas-manager + export split):** open the PWA,
  capture / paste an image, verify the editor mounts. Save the
  edited image — confirms the editor-side save path. Open the
  gallery, confirm thumbnails render — this exercises the
  `renderImageRecord` path now living in `@ingcreators/annot-render`
  via the storage backends. This is the riskiest single move;
  if anything breaks it'll be here.

## Migration notes

- **No data migration.** SVG schema unchanged. Storage backends
  unchanged. `data-annot-version` unchanged.
- **No API break for external callers.** `@ingcreators/annot-core`
  continues to export the headless surface from its root. New
  `@ingcreators/annot-editor` package is purely additive from
  the workspace's perspective.
- **Internal importers update over the course of the migration.**
  Each phase's PR description lists exactly which files move and
  which importers it touches. Before-and-after grep counts in the
  commit `Verified:` paragraph make any miss easy to spot in
  review.
- **`core/editor/index.ts` shrinks each phase.** Phase 9 ends with
  it re-exporting only Tier B symbols (svg-format, toolbar-icons,
  the element-taking utilities). The "browser-only" section of
  the comment block in that file is deleted entirely — there is
  no browser-only code in `core/editor/` after Phase 8.
- **The `pre-release-cleanup` plan and this plan are
  complementary.** That plan delivered the API boundary (root
  becomes headless-by-construction); this plan delivers the
  matching physical layout.

## Forward pointers

Two strategic follow-ups become unblocked after this plan
lands:

1. **Gallery bulk export** (out of scope here) gets a clean
   home in `@ingcreators/annot-render`. Future
   `exportZip(records[])`, `exportMultiSlidePptx(records[])`,
   etc. join `renderImageRecord` there. Also unblocks the
   refactor of today's `pptx-export.ts` — currently
   `CanvasManager`-coupled and living in `annot-editor` —
   to take an `ImageRecord` (or list of them) and migrate
   to `annot-render`.

2. **Headless annotator prototype** (one-week spike currently
   listed in CLAUDE.md "Pending work"). With the boundary
   now both API-true and physically-true, the prototype can
   pick up the Tier B element-takers under jsdom (or
   `resvg-js` for pure-SVG generation) without dragging
   Tier C into the bundle. If the prototype also needs
   bitmap rasterisation (e.g. for PR-comment thumbnail
   posting), it imports `@ingcreators/annot-render`
   under jsdom + `node-canvas`.
