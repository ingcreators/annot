# Three-package split

> **Status:** Draft
> **Compatibility:** Introduces a new `@ingcreators/annot-editor`
>                    workspace package. No external API breakage
>                    (pre-release). Internal importers across web +
>                    extension + desktop migrate from
>                    `@ingcreators/annot-core/editor/...` to
>                    `@ingcreators/annot-editor/...` over the
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
ships from a dedicated `@ingcreators/annot-editor` package.

The desired final layout reflects three audiences:

| Audience | Reads from | Runtime |
|----------|-----------|---------|
| Headless annotator (Playwright fixture, GitHub Action) | `@ingcreators/annot-core` (+ optionally `@ingcreators/annot-core/editor` under jsdom) | pure Node, jsdom for Element-taking helpers |
| Editor library consumer (`annot-cloud`, future plugins) | `@ingcreators/annot-editor` | real browser |
| PWA / extension / desktop hosts | `@ingcreators/annot-web` (which depends on the two above) | real browser |

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

(`@ingcreators/annot-web` continues to depend on all three for
the PWA app shell. `annot-extension` and `annot-desktop` likewise
pick up Tier C through the editor package.)

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
| `export.ts` | `XMLSerializer` + `Blob` + `URL.createObjectURL` + canvas rasterisation |
| `pptx-export.ts` | `<canvas>` for slide-background rasterisation |

**Note on `redact-utils`, `export.ts`, `pptx-export.ts`.** An
earlier draft of this plan kept these three in Tier B as
"DOM-ish helpers", citing a hypothetical circular import.
Tracing the actual dependency graph showed the concern was
unfounded:

- `redact-utils` is consumed only by `property-panel.ts` and
  `tools/redact-tool.ts` — both already Tier C.
- `pptx-export.ts` is consumed only by `web/src/editor/toolbar-save-menu.ts`
  (already in the editor-dependent web package).
- `export.ts`'s `renderImageRecord` is consumed by
  `packages/web/src/storage/{device,github,google-drive}-store.ts`,
  which would gain a transitive dependency on
  `@ingcreators/annot-editor`. That's honest: those storage
  backends already use `<canvas>` for thumbnail generation
  and are unportable beyond a real browser. A future
  `annot-cloud` server-side GitHub storage would not reuse
  the browser `GitHubStore`; it would call octokit + sharp /
  resvg directly.

So all three move to Tier C. The benefit: Tier B becomes the
honest definition "jsdom-friendly Element manipulation, no
`<canvas>` rasterisation required" — exactly the surface a
headless-annotator (running under jsdom or `resvg-js`) wants to
reach for.

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
      export.ts
      pptx-export.ts
      tools/
        tool-base.ts
        arrow-tool.ts
        crop-tool.ts
        freehand-tool.ts
        marker-tool.ts
        redact-tool.ts
        shape-tool.ts
        text-tool.ts

  web/                        # PWA shell (unchanged structure)
  extension/                  # MV3 extension (unchanged)
  desktop/                    # Tauri host (unchanged)
```

`@ingcreators/annot-editor` depends on `@ingcreators/annot-core`
(both Tier A and Tier B subpath).
`@ingcreators/annot-web` adds `@ingcreators/annot-editor` to its
dependencies.
`@ingcreators/annot-extension` already imports
`@ingcreators/annot-web/editor/toolbar`; it picks up the editor
package transitively via web.
`@ingcreators/annot-desktop` updates from
`@ingcreators/annot-core/editor/canvas-manager` (etc.) to
`@ingcreators/annot-editor`.

## Phased plan

Each phase lands as its own PR. Each PR keeps the workspace
green (typecheck, tests, lint, builds). The original
`core/editor/<file>.ts` is deleted in the same PR that moves it
— **not** kept as a re-export shim, since this is a pre-release
window and the indirection would mask future drift.

| Phase | Scope | PR count |
|-------|-------|----------|
| **0** | Set up the empty `@ingcreators/annot-editor` workspace package: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.ts` re-exporting only `svg-format` (placeholder, not the final shape). `pnpm install` + green CI. | 1 |
| **1** | Move the **leaf DOM widgets** (no dependencies on other Tier C primitives): `tooltip.ts`, `theme-toggle.ts`, `custom-select.ts`, `anchored-popover.ts`, `canvas-context-menu.ts`, `color-palette.ts`, **`redact-utils.ts`**. Update importers in web + extension. (`redact-utils` joins because its only Tier-C consumers — `redact-tool` and `property-panel` — both move later, so it can land in this batch and become a one-import-line edit when those land.) | 1 |
| **2** | Move `property-controls.ts`. Update importers (mostly `core/editor/property-panel.ts`, web's `tool-property-renderer.ts`). | 1 |
| **3** | Move the **PropertyPanel cluster**: `property-panel.ts` + `property-panel-helpers.ts`. Importers in web (right-panel + selection-properties section) + desktop. | 1 |
| **4** | Move **`History`** to the editor package. Despite being pure-ish, it works on `SVGGElement.innerHTML` and is consumed only by editor primitives. | 1 |
| **5** | Move the **tool hierarchy**: `tools/tool-base.ts`, `tools/{shape,arrow,text,freehand,marker,redact,crop}-tool.ts`. Largest single move; ~7 files + heavy importers in web's toolbar / property renderer / scratchpad. | 1 |
| **6** | Move `smart-guides.ts`. | 1 |
| **7** | Move `selection.ts` + `selection-helpers.ts`. | 1 |
| **8** | **Keystone**: move `canvas-manager.ts` together with **`export.ts`** and **`pptx-export.ts`**. The two export modules type-import `CanvasManager`, so colocating their move with canvas-manager is the lowest-friction option. After this PR, `core/editor/` no longer holds any Tier C code. | 1 |
| **9** | **CLAUDE.md** + plan-doc updates: drop the "editor UI in core can use DOM APIs" carve-out from `Architectural guardrails 2`. Record the Tier A / B / C model in the public-API section. Mark this plan `Done`. | 1 |
| **10** | **Headless annotator prototype kickoff** (separate plan): now that the boundary is honest, the "headless annotator prototype" item in CLAUDE.md's pending-work list becomes actionable. Out of scope for this plan; left as a forward pointer. | n/a |

Phase ordering matters because Tier C files import each other: the
PropertyPanel imports tooltip, the SelectionManager imports
arrow-markers (Tier B — no problem), the tools import canvas-manager.
By moving leaf widgets first, then the panel, then tools, then
selection, then canvas-manager last, every intermediate phase
compiles without circular imports. Within `core/editor/index.ts`
the surviving Tier B re-exports stay until Phase 9 cleans them up.

## Verification

Per-phase pre-landing checklist (additions to the standard CLAUDE.md
checklist):

- [ ] `pnpm install` re-resolves the workspace without lockfile churn
      beyond the new package's own dependencies.
- [ ] `pnpm -r typecheck` — pass.
- [ ] `pnpm test` — 253+ pass (no regression in count).
- [ ] `pnpm --filter @ingcreators/annot-core build` — pass.
- [ ] `pnpm --filter @ingcreators/annot-editor build` — pass (after Phase 0).
- [ ] `pnpm --filter @ingcreators/annot-web build` — pass.
- [ ] `pnpm --filter @ingcreators/annot-extension build` — pass.
- [ ] `pnpm lint` — 0 findings.
- [ ] `headless.test.ts` continues to pass — boundary not regressed.
- [ ] CI green on the PR.

Stage-specific extras:

- **Phase 0:** confirm the new package shows up in `pnpm -r ls --depth=-1`.
- **Phase 5 (tools):** spot-check each tool in the PWA — pick the
  Shape, Arrow, Text, and Marker tools, draw one annotation each,
  confirm save round-trips.
- **Phase 8 (canvas-manager):** open the PWA, capture / paste an
  image, verify the editor mounts. This is the riskiest single
  move; if anything breaks it'll be here.

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

## Forward pointer

After this plan lands, the next strategic step is the
**headless annotator prototype** (one-week spike currently
listed in CLAUDE.md "Pending work"). With the boundary now
both API-true and physically-true, the prototype can pick up
the Tier B element-takers under jsdom (or `resvg-js` for pure-SVG
generation) without dragging Tier C into the bundle.
