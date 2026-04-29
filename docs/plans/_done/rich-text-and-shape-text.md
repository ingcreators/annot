# Rich text + text-on-shape (PowerPoint-style text handling)

> **Status:** Done — landed 2026-04-29 across PRs
> [#326](https://github.com/ingcreators/annot/pull/326)
> (Phase 1: unified `<g data-type="shape">` skeleton +
> `runs[]` ABI carrier + spec doc),
> [#327](https://github.com/ingcreators/annot/pull/327)
> (Phase 2: contentEditable ↔ TextRun mapper + Ctrl+B/I/U
> shortcuts + floating mini-toolbar),
> [#328](https://github.com/ingcreators/annot/pull/328)
> (Phase 3: Pattern A — double-click a bare rect to add text;
> lazy promotion + cancel-without-typing rollback),
> [#329](https://github.com/ingcreators/annot/pull/329)
> (Phase 4: textBold / textItalic / textUnderline toggles in
> the PropertyPanel's textbox category card), and
> [#330](https://github.com/ingcreators/annot/pull/330)
> (Phase 5: OOXML rich-text goldens — runs walker output
> pinned in `drawingml-rich-text.test.ts`).
>
> Phase 6 (this archival PR) tightens CLAUDE.md's rich-text
> mention and moves the plan to `_done/`.

> **Original status header (kept for historical reference):**
> Draft
> **Compatibility:** `@ingcreators/annot-core` (text-utils,
> property-schema, tool-registry), `@ingcreators/annot-editor`
> (text-tool, shape-tool, property-panel, contentEditable host),
> `@ingcreators/annot-render` (pptx-export text builder), Tauri Office
> paste (no Rust changes — emits via the shared TS builder per
> `_done/office-paste-shared-drawing-builder.md`).
> **Risk:** Large surface area; phased migration is essential. SVG
> format stays at **v1** — Annot is pre-release, the schema is still
> mutable, the new attributes / structure are added in place without
> a version bump, and **backward compatibility with documents
> written by older Annot builds is NOT a goal**. Per-user pre-release
> dumps are disposable; the new reader / writer assume the unified
> shape skeleton everywhere. PPTX/Office round-trip is gated by
> goldens. Editor UX changes are the riskiest part — `contentEditable`
> ↔ `<tspan>` mapping is the load-bearing piece and gets its own
> phase.

## How to resume in a fresh session

```
"Read docs/plans/rich-text-and-shape-text.md and start <phase>."
```

Each phase is independently merge-able and CI-green on its own.

## Context

Two PowerPoint behaviours users expect that Annot doesn't currently
support:

1. **Pattern A — "Insert shape, then add text inside"**
   Today: `ShapeTool` emits a bare `<rect>` / `<ellipse>` /
   highlight `<rect>` with no text affordance. Double-clicking a
   shape does nothing. Users wanting a labelled rectangle have to
   draw the rectangle, draw a separate plain-textbox, and align by
   eye. There's no "text inside this shape" concept.
2. **Pattern B — "Insert a text-bearing shape from the start"**
   Already partially supported via `TextTool`'s three variants
   (`plain` / `sticky` / `callout`), but text formatting is uniform
   per textbox: one `font-size`, one `font-family`, one `color`. No
   per-character bold / italic / underline / mixed-color / mixed-size.

What we want:

- **Both patterns produce the same on-disk SVG shape.** A "rect with
  text" and a "callout" are both `<g data-type="shape">` wrappers
  carrying a geometry child + an optional `<text>` child. The
  current `TextTool` and `ShapeTool` outputs converge on this
  structure so the property panel, selection / resize, and PPTX
  export all see ONE thing.
- **Rich (per-character) text formatting** — font family, size,
  color, bold, italic, underline — stored as native SVG `<tspan>`
  attributes. Each `<tspan>` becomes one OOXML `<a:r>` (run) on
  export.
- **Editing UX matches the surrounding tools.** Double-click a
  shape to edit text in-place. Selection inside the text editor
  drives a formatting affordance (PropertyPanel "Text" section
  when an element is selected; floating mini-toolbar when a text
  range is selected during edit).

## Existing surface (anchors for the plan)

| Concern | Current home | Notes |
|---|---|---|
| Textbox skeleton | [`packages/core/src/editor/text-utils.ts:103`](../../packages/core/src/editor/text-utils.ts:103) `createTextBox` | `<g data-type="textbox">` + `<rect>` bg + `<clipPath>` + `<text>` with one `<tspan>` per line. Per-line attrs only on the parent `<text>`. |
| Textbox edit UX | [`packages/editor/src/tools/text-tool.ts:92`](../../packages/editor/src/tools/text-tool.ts:92) `#startEditing` | `<foreignObject>` + `contentEditable` div. `innerText` extracted on commit; no span info preserved. |
| Shape geometry | [`packages/editor/src/tools/shape-tool.ts:26`](../../packages/editor/src/tools/shape-tool.ts:26) `onPointerDown` | Emits `<rect>` / `<ellipse>` directly — no `<g>` wrapper. |
| Property panel text controls | [`packages/core/src/editor/property-schema.ts:60`](../../packages/core/src/editor/property-schema.ts:60) | `fontSize` / `fontFamily` / `textColor` (mapped to `strokeColor`) / `textVariantPicker`. No bold/italic/underline. |
| Tool registry | [`packages/core/src/editor/tool-registry.ts`](../../packages/core/src/editor/tool-registry.ts) | `text` entry has `extractStyleFromElement` / `applyStyleToElement` reading the parent `<text>`'s attrs. Shape entries have no text awareness. |
| PPTX text builder | [`packages/render/src/drawingml/shapes/text.ts:34`](../../packages/render/src/drawingml/shapes/text.ts:34) | One `<a:r>` per paragraph, uniform `<a:rPr>`. Newlines split paragraphs. |
| SVG format spec | [`docs/svg-format.md:101`](../svg-format.md:101) | "Text / sticky / callout" section. Documents `data-variant` + `data-font-*` only. `data-annot-version="1"`. |

## Design

### 1. Unified element shape: `<g data-type="shape">`

All text-bearing shapes — current textboxes (plain / sticky /
callout) AND future text-on-rect / text-on-ellipse — use one
DOM skeleton:

```xml
<g data-type="shape" data-shape-kind="rect|rounded|ellipse|sticky|callout|plain"
   data-text-anchor="middle|start|end" data-text-vanchor="middle|top|bottom">
  <rect ... />            <!-- or <ellipse>, or <path> for callout. Geometry only. -->
  [<path data-tail="1" ... />]   <!-- callout tail, optional -->
  <clipPath id="..."><rect .../></clipPath>
  <text clip-path="url(#...)">
    <tspan x="..." y="..." [font-weight="bold"] [font-style="italic"]
           [text-decoration="underline"] [font-size="..."]
           [font-family="..."] [fill="..."]>...</tspan>
    ...
  </text>
</g>
```

Key shifts vs today:

- **`data-shape-kind` replaces `data-text-variant`.** New values
  `rect` / `rounded` / `ellipse` are introduced for Pattern A;
  the existing `plain` / `sticky` / `callout` values move from
  `data-text-variant` onto `data-shape-kind`. The reader REQUIRES
  `data-shape-kind` for `data-type="shape"` elements — there is
  no fallback to the old `data-text-variant` attribute.
- **`<rect>` / `<ellipse>` / `<path>` ARE the geometry primitive.**
  No more "background rect that happens to be the geometry"
  ambiguity. Highlight rects (`data-highlight="1"`) keep their
  existing semantics; they MAY get text in Pattern A but the
  geometry stays a stroke-less filled rect.
- **`<text>` is optional.** A bare `<g data-type="shape">` with
  no `<text>` child is a textless shape — equivalent to today's
  `<rect>` / `<ellipse>` direct emission.
- **Per-`<tspan>` styling is the source of truth.** The parent
  `<text>` carries the *default* formatting (font-size /
  font-family / fill); `<tspan>` overrides cascade. A textbox
  with uniform styling has no per-tspan override attrs and looks
  identical to today's output.
- **`data-text` shadow attribute is dropped.** The plain-text
  body is reconstructable from `<tspan>` `textContent`; carrying
  it in two places breaks the single-source-of-truth invariant.
  Readers do NOT consult it.
- **`data-text-anchor` / `data-text-vanchor` control layout.**
  Default `middle` / `middle` (PowerPoint's default for text
  inside a shape). Sticky / callout fall back to `start` / `top`
  to match their existing visual. The text-utils layout pass
  computes `x` / `y` for each `<tspan>` from these anchors +
  the geometry bbox.

### 2. SVG format stays at v1, no backward compatibility

Annot is pre-release, so the schema is treated as mutable: the new
attributes (`data-shape-kind` on the wrapping `<g>`, per-`<tspan>`
formatting attrs, `data-text-anchor` / `data-text-vanchor`) are
added in place without bumping `data-annot-version`. The stamp
stays `1`. There is no v2.

**Backward compatibility with older Annot builds is not a goal.**
Pre-release dumps are disposable. The new reader recognises ONLY
the unified shape skeleton:

- `data-type="shape"` with `data-shape-kind` ∈ `{rect, rounded,
  ellipse, plain, sticky, callout}` is the only text-bearing form.
- The reader does NOT consult `data-type="textbox"`,
  `data-text-variant`, or the `data-text` shadow attribute. The
  legacy paths are deleted, not preserved.
- Documents saved by older builds (containing `data-type="textbox"`
  / etc.) will fail to render their text-bearing elements after
  this plan lands. Acceptable because no shipped 1.0 product is
  exposed to that format.

Format spec doc ([`docs/svg-format.md`](../svg-format.md)) is
amended in place: the existing "Text / sticky / callout" section
is rewritten as "Text-bearing shapes" covering the unified
schema, with a new "Per-character formatting" subsection. The
"Version history" entry for v1 is updated to reflect the final
pre-release shape; no v2 row is added.

### 3. Editor UX

#### 3a. Pattern A entry: double-click a shape to add text

`ShapeTool`'s output stays as raw `<rect>` / `<ellipse>` (no
forced wrapping for shapes drawn fresh) until the user adds
text. The first time the user double-clicks a textless shape,
the shape is **promoted in place** to `<g data-type="shape"
data-shape-kind="...">` wrapping the existing geometry, an
empty `<text>` is added, and the contentEditable overlay
appears. If the user types nothing and dismisses, the promotion
is undone (back to bare geometry) so paint order / SVG
cleanliness is preserved.

A dedicated "Add text" action in the canvas right-click menu
mirrors the same code path for users who don't discover
double-click.

#### 3b. Pattern B entry: TextTool unchanged

`TextTool`'s drag-out + edit flow continues to work exactly as
today; under the hood it now emits the unified `<g
data-type="shape" data-shape-kind="sticky|plain|callout">`
shape and the contentEditable round-trip understands rich text.
Existing plain/sticky/callout users see no behaviour change
beyond the new formatting affordances during edit.

#### 3c. Edit-mode UX (rich text)

The contentEditable host:

- Receives Ctrl+B / Ctrl+I / Ctrl+U keyboard shortcuts. Each
  toggles the corresponding inline span on the current selection
  (or the next-typed character if the selection is collapsed).
- Receives a **floating mini-toolbar** that appears above the
  current selection rect when a non-empty range is selected.
  Buttons: Bold / Italic / Underline / Font family / Font size /
  Color. Mirrors PowerPoint's "Mini Toolbar" UX.
- On commit, the host walks the contentEditable DOM and emits
  one `<tspan>` per styled run. Style transitions split runs;
  uniformly-styled text is one `<tspan>` per line (today's
  shape).
- On re-edit, the host reconstructs HTML from the existing
  `<tspan>` children (one `<span>` per `<tspan>` plus
  `<br>` between lines).

The mini-toolbar lives in `@ingcreators/annot-editor` (Tier C)
as a Lit component; the SVG↔HTML rich-text mapper lives in
`@ingcreators/annot-core/editor` (Tier B — pure DOM
manipulation, jsdom-friendly, no `<canvas>` / pointer events).

#### 3d. PropertyPanel "Text" section

Today's `fontSize` / `fontFamily` / `textColor` controls move
into a new "Text" section (separate from "Line"). New controls:

- `bold` (toggle) / `italic` (toggle) / `underline` (toggle) —
  three-state buttons (off / mixed / on) when a heterogeneous
  selection is active.
- `textAnchor` (left / center / right pulldown) — writes
  `data-text-anchor` on the `<g>`.
- `textVerticalAnchor` (top / middle / bottom pulldown) —
  writes `data-text-vanchor`.

Behaviour rules:

| User context | Section behaviour |
|---|---|
| Element selected (no edit) | Controls write to ALL `<tspan>`s of the element. Mixed-state controls show "—" (intermediate) and a "Make uniform" affordance. |
| Editing a text range | Controls apply to the selected range only. Stay in sync with the floating mini-toolbar (single source of truth — both surfaces dispatch the same effect handler). |
| No element / shape without text | Section hidden. |

The `PROPERTY_CONTROLS` registry gains the three formatting
toggles + the two anchor pulldowns. Each declares an
`effect: PropertyEffectId` because the write is a per-`<tspan>`
mutation that doesn't fit `setValue` / `replace`. Effect
handlers live in `PropertyPanel`'s constructor per the existing
schema-driven trilogy.

### 4. PPTX / Office paste

`buildText` in
[`packages/render/src/drawingml/shapes/text.ts`](../../packages/render/src/drawingml/shapes/text.ts)
currently emits `<a:p><a:r><a:rPr ...><a:t>line</a:t></a:r></a:p>`
per line. The OOXML run model already supports per-run
formatting — multiple `<a:r>` children per `<a:p>` each with
their own `<a:rPr>`. The plan:

- `AnnotationShape.text` (the carrier on the TS↔Rust ABI from
  `_done/office-paste-abi-modernisation.md`) is replaced by
  `runs: TextRun[]`. The plain `text` field is removed (no
  callers need both — the few that want only a string can
  `runs.map((r) => r.text).join("")`).
- `TextRun` shape:
  ```ts
  interface TextRun {
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    font_size?: number;     // px, like the existing carrier
    font_family?: string;
    color?: string;          // "#rrggbb"
    line_break_after?: boolean;  // ends the paragraph
  }
  ```
- `buildText` walks `runs`, opening a new `<a:p>` after each
  `line_break_after`. Each run becomes one `<a:r>` with `<a:rPr
  b="1" i="1" u="sng" sz="..." ...><a:solidFill>...`. The legacy
  `text` + line-split fallback is removed.
- `transformOf` for `data-type="shape"` (replacing the current
  textbox transformer) walks the SVG `<tspan>`s and emits the
  matching `runs` array.
- For a uniformly-styled shape, `runs` is one entry per line
  with no formatting flags — output is byte-identical to the
  current shape (validated by the existing PPTX golden test).
- Office paste path uses the same `buildShapeXml` + `runs` since
  the shared builder migration. **No Rust changes required.**
  Confirms the "one transformer + one builder" contract from
  `_done/office-paste-shared-drawing-builder.md` still holds
  after this feature.

A new golden snapshot test (`pptx-export-rich-text.test.ts`)
pins the OOXML output for: bold + italic + underline + mixed
fonts + mixed colors + mixed sizes within one paragraph and
across paragraphs. The Tauri side picks it up via the cross-
impl byte-equivalence test (renamed to allow the rich-text
input case as part of Phase 5).

### 5. Persistence (TextTool preset)

The TextTool's preset (in `TOOL_REGISTRY.text.presetFields`)
gains `bold` / `italic` / `underline` / `textAnchor` /
`textVerticalAnchor`. These are the **default formatting** for
new text — every freshly-typed character starts with these
flags. The PropertyPanel's edit-time controls modify the active
selection only, not the preset.

`presetToWire` / `presetFromWire`
([`packages/core/src/editor/tool-preset-serde.ts`](../../packages/core/src/editor/tool-preset-serde.ts))
walk `presetFields` automatically, so the file / localStorage /
chrome.storage round-trip costs ~zero per the existing
schema-driven design.

`extractStyleFromElement` / `applyStyleToElement` for the text
tool gain symmetric reads / writes for the new attrs (paired
test in `tool-registry.test.ts` enforces no missing side).

## Phased plan

Five PRs, each independently revertable. The recommended order
runs the lowest-risk pieces (schema + format) first so later
phases can build on a stable on-disk shape.

### Phase 1 — Unified text-bearing shape skeleton + reader/writer changes

**Goal:** Land the unified `<g data-type="shape" data-shape-kind="...">`
skeleton + the rich-text-aware reader/writer + spec doc edits.
The old `data-type="textbox"` / `data-text-variant` / `data-text`
read paths are deleted in the same PR — no legacy fallback. No
new UI; the TextTool keeps emitting today's uniform formatting
via the new skeleton. The format version stamp stays `1`.
Existing tests adjust to the new on-disk shape; a new round-trip
golden pins it.

**Files:**

- `packages/core/src/editor/text-utils.ts` —
  - Replace `createTextBox` with `createTextShape(spec)` emitting
    the unified skeleton. Update all call sites in the same PR;
    no shim.
  - `readTextBoxSpec` becomes `readTextShapeSpec` returning
    `runs: TextRun[]` (one entry per `<tspan>`) plus the
    shape-level metadata. Reads ONLY `data-type="shape"` with
    `data-shape-kind`; throws on the old textbox shape so a stray
    legacy element fails loudly rather than silently degrading.
  - `convertTextVariant` continues to work; under the hood
    delegates to `createTextShape` with the new variant. The
    `TextVariant` type expands to the unified `ShapeKind` union.
- `packages/core/src/editor/svg-format.ts` —
  - No version-stamp logic changes. The format version stays
    `1`; the new `data-shape-kind` / per-tspan attrs are absorbed
    into the existing v1 schema. Confirm with a unit test that
    saving a rich-formatted document still emits
    `data-annot-version="1"`.
- `packages/render/src/drawingml/shapes/text.ts` —
  - Replace the `text` + line-split path with a `runs:
    TextRun[]` walker (one `<a:r>` per run, paragraph break on
    `line_break_after`). The `text` field is removed from
    `AnnotationShape`. Existing PPTX golden untouched (the seed
    is uniformly-formatted; runs collapse to one-per-line with
    no formatting flags, byte-identical output).
- `packages/core/src/editor/svg-to-annotation-shapes.ts` —
  - `transformOf` for `data-type="shape"` extracts `runs` from
    `<tspan>`s, populates the carrier. The previous textbox
    transformer entry is deleted.
- `docs/svg-format.md` —
  - Rewrite "Text / sticky / callout" → "Text-bearing shapes"
    covering the unified `<g data-type="shape">` schema. Add
    "Per-character formatting" subsection. Update the
    "Version 1" history entry in place to reflect the final
    pre-release shape — no v2 row added.
- `packages/core/src/editor/text-shape.test.ts` (new) —
  - Round-trip: build a shape with mixed bold/italic/underline,
    serialize, parse, compare runs structurally.
  - Uniform case: build a shape with one font/size/color, confirm
    runs collapse to one entry per line with no formatting flags.
  - Reject legacy: parsing an old `data-type="textbox"` element
    throws (no silent fallback).

**Acceptance:**

- `pnpm -r typecheck` green
- `pnpm test` green; new round-trip + uniform-collapse + legacy-
  rejection tests pass; the version-stamp test confirms
  `data-annot-version="1"` regardless of whether the document
  carries rich formatting
- `pnpm --filter @ingcreators/annot-core build` /
  `--filter @ingcreators/annot-render build` /
  `--filter @ingcreators/annot-web build` green
- Existing PPTX golden unchanged (no rich formatting input)
- Manual: create a fresh sticky note, save, confirm the SVG is
  `<g data-type="shape" data-shape-kind="sticky">` with
  `data-annot-version="1"`. Re-open and re-edit, confirm it
  round-trips. Pre-existing local data is expected to break;
  no migration is provided.

### Phase 2 — Rich-text editing in TextTool's contentEditable host

**Goal:** Land the contentEditable ↔ `<tspan>` mapper + Ctrl+B/I/U
keyboard shortcuts + floating mini-toolbar. PropertyPanel changes
land in Phase 4; this phase is editor-internal.

**Files:**

- `packages/core/src/editor/rich-text-mapper.ts` (new, Tier B) —
  - `htmlToRuns(div: HTMLElement): TextRun[]` walks `contentEditable`
    output, normalising `<b>` / `<strong>` / `<i>` / `<em>` / `<u>` /
    inline `style` attrs into the canonical `TextRun` shape.
    Splits on `<br>` and block boundaries.
  - `runsToHtml(runs: TextRun[]): string` inverse — emits
    `<span style="...">` per run, `<br>` for paragraph breaks.
  - Round-trip property tests: any `runs[]` round-trips through
    HTML byte-equivalent up to canonical attribute ordering.
- `packages/editor/src/tools/text-tool.ts` —
  - `#startEditing` accepts `runs` instead of plain `text`,
    populates the contentEditable via `runsToHtml`.
  - `#finishEditing` reads `runs` via `htmlToRuns`, passes to
    `createTextShape` (the new constructor).
  - Keyboard shortcuts: Ctrl+B / Ctrl+I / Ctrl+U → call
    `document.execCommand('bold' / 'italic' / 'underline')`
    against the contentEditable. (Acknowledged-deprecated API,
    but the canonical contentEditable formatting path; the
    mini-toolbar gives an alternative for users on browsers
    where execCommand drops support.)
- `packages/editor/src/text-mini-toolbar.ts` (new, Lit, Tier C) —
  - `<annot-text-mini-toolbar>` component. Subscribes to
    `selectionchange` on the host's document while a TextTool
    edit session is active, repositions itself above the
    selection rect, dispatches Bold/Italic/Underline +
    font/size/color picker events.
  - Co-located `text-mini-toolbar.stories.ts` per the Storybook
    convention.
- `packages/editor/src/text-mini-toolbar.test.ts` —
  - happy-dom test: with a selection, click each button,
    confirm the resulting span structure.

**Acceptance:**

- `pnpm test` green; rich-text mapper round-trip property test
  passes (≥100 randomised cases)
- Mini-toolbar story renders on Storybook (CI build green)
- Manual smoke-test: TextTool, type "Hello world", select
  "world", Ctrl+B, finish — saved SVG has two `<tspan>`s, the
  second with `font-weight="bold"`. Re-edit, confirm the bold
  span re-renders in the contentEditable. PowerPoint paste
  preserves bold (Phase 5 polishes the cross-app round-trip).

### Phase 3 — Pattern A: text on shapes

**Goal:** Wire double-click on `ShapeTool`-emitted shapes (and
the canvas right-click "Add text" item) into the same edit flow
as Phase 2. Promote bare `<rect>` / `<ellipse>` to
`<g data-type="shape">` lazily.

**Files:**

- `packages/editor/src/tools/text-tool.ts` —
  - `#setupDoubleClick` widens its target query from
    `g[data-type='textbox']` to `g[data-type='shape'], rect:not([data-redact-style]), ellipse`
    (and the highlight-rect with `data-highlight="1"`).
    Promotion logic for bare geometry: wrap in
    `<g data-type="shape" data-shape-kind="...">` + an empty
    `<text>`, run the existing edit flow, on cancel-without-
    typing roll back the promotion.
- `packages/web/src/editor/toolbar-canvas-menu.ts` —
  - "Add text" action visible when the right-clicked element is
    a textless shape.
- `packages/core/src/editor/tool-registry.ts` —
  - `shape` entry's `extractStyleFromElement` /
    `applyStyleToElement` understand the wrapping `<g>`. The
    existing geometry-attr path keeps working for textless
    shapes; the registry's `variantKeyForElement` for shape
    still returns the geometry shape kind.
- `packages/core/src/editor/svg-format.ts` —
  - No version-stamp logic changes (format stays at v1). Add a
    test case confirming "shape promoted from a bare `<rect>`
    via Pattern A still stamps `v=1`".
- `packages/editor/src/tools/text-tool.test.ts` (new) —
  - happy-dom: draw a rect, double-click, type "x", finish,
    confirm SVG is `<g data-type="shape" data-shape-kind="rect">`.
  - Same path with cancel-without-typing reverts to bare
    `<rect>`.

**Acceptance:**

- `pnpm test` green
- `pnpm --filter @ingcreators/annot-web build` green
- Manual smoke-test: draw a rectangle, double-click, type
  "Hello", press Esc — SVG has the unified shape; reload, the
  text re-appears. Draw another rectangle, double-click, press
  Esc without typing — SVG stays a bare `<rect>`. Right-click
  on a bare ellipse → "Add text" works equivalently.

### Phase 4 — PropertyPanel "Text" section (Bold / Italic / Underline / anchors)

**Goal:** Surface the rich-text formatting on the right panel
when an element has text. PropertyPanel becomes the single
source of truth for formatting from outside the edit session;
the mini-toolbar from Phase 2 stays as the inside-edit
affordance.

**Files:**

- `packages/core/src/editor/property-schema.ts` —
  - New control IDs: `bold`, `italic`, `underline` (toggle), 
    `textAnchor`, `textVerticalAnchor` (select).
  - All five declare `effect: PropertyEffectId` because the
    write is a per-`<tspan>` mutation. Effect IDs:
    `applyBold` / `applyItalic` / `applyUnderline` /
    `applyTextAnchor` / `applyTextVerticalAnchor`.
  - `CATEGORY_CONTROL_SHAPE.shape` and `.text` gain the new IDs.
  - Existing `fontSize` / `fontFamily` / `textColor` move to the
    new "Text" section (was "Line"). Confirm the change is
    intentional in the renderer goldens — bumping any DOM-byte
    snapshots is a deliberate part of this PR.
- `packages/editor/src/property-panel.ts` —
  - Effect handlers for the five new IDs. Each walks the
    selection's text targets and applies the mutation:
    - Toggle effects (`applyBold` / `applyItalic` /
      `applyUnderline`): if every `<tspan>` already has the flag
      on, remove it; if any is off, add it (mirrors PowerPoint).
    - Anchor effects: write the `data-text-*` attr on the `<g>`,
      relayout `<tspan>` x/y via a reusable layout helper in
      `text-utils.ts`.
- `packages/web/src/editor/tool-property-renderer.ts` —
  - TextTool's `panelControls` add the new IDs in the "Text"
    section (these become the per-tool *defaults* for new text;
    they map onto preset fields via the existing
    `TOOL_PANEL_ADAPTERS` table).
- `packages/core/src/editor/tool-registry.ts` —
  - TextTool's `presetFields` add `bold` / `italic` /
    `underline` / `textAnchor` / `textVerticalAnchor`.
  - `extractStyleFromElement` reads default formatting from the
    parent `<text>` (uniform-formatting case);
    `applyStyleToElement` writes back. The `tool-registry.test.ts`
    symmetry assertion catches missing pairs.
- `packages/editor/src/property-panel-renderer.test.ts` /
  `packages/web/src/editor/tool-property-renderer.test.ts` —
  - New goldens for each "Text" section state.

**Acceptance:**

- `pnpm -r typecheck` / `pnpm test` / `pnpm lint` green
- Renderer goldens updated and reviewed — diff shows the
  intentional restructuring (existing controls migrating to
  "Text" + new toggles appearing).
- Manual smoke-test: select a textbox, click Bold in the right
  panel — every `<tspan>` gains `font-weight="bold"`. Click
  again — flag clears. Mixed-state behaviour: select a textbox
  whose first half is bold and second half isn't, the Bold
  button shows the mixed-state ("—"); first click makes it
  uniformly bold, second click clears.

### Phase 5 — PPTX / Office paste polish + cross-app goldens

**Goal:** Lock down the cross-app round-trip. Goldens for the
rich-text PPTX path; cross-impl byte-equivalence between PPTX
export and Office clipboard paste.

**Files:**

- `packages/editor/src/pptx-export-rich-text.test.ts` (new) —
  - Seed: a textbox with mixed formatting (bold, italic,
    underline, mixed font, mixed color, mixed size, multi-line).
  - Pin the OOXML output via `toMatchInlineSnapshot()`. PR
    reviews go through the snapshot.
- `packages/desktop/src-tauri/tests/office-paste-rich-text.rs`
  (or extend the existing cross-impl test) —
  - Same seed run through `buildShapeXml` from TS; the Tauri
    Office-clipboard path consumes the prebuilt drawing XML
    (Rust is packaging-only since
    `_done/office-paste-shared-drawing-builder.md` Phase 3), so
    the assertion is "Rust-side packaging stays byte-identical
    when handed the Phase 5 rich-text XML".
- `docs/svg-format.md` — Polish "Per-character formatting"
  section with the final attribute set. The "Version 1" history
  entry already covers the new schema additions in place (no v2
  added per the pre-release schema-fluidity stance).

**Acceptance:**

- `pnpm test` green; rich-text PPTX golden pinned.
- Tauri Rust test green (or its TS equivalent if the Rust
  cross-impl test needs no updates).
- Manual: paste a rich-formatted textbox into PowerPoint
  desktop. Bold/italic/underline survive. Per-run color
  survives. Save the deck, re-open, formatting is preserved.

### Phase 6 — Cleanup + plan archival

**Goal:** Finalise the spec doc, archive the plan.

**Files:**

- `CLAUDE.md` — extend the "Architectural guardrails" §5 surface
  table (`@ingcreators/annot-core` subpaths) with one sentence
  noting the unified text-shape skeleton + per-tspan formatting.
  Don't re-document the schema details here — the plan + the
  spec doc carry that.
- Move
  [`docs/plans/rich-text-and-shape-text.md`](./rich-text-and-shape-text.md)
  → `docs/plans/_done/rich-text-and-shape-text.md` with status
  header noting the landing PR range.
- Update `docs/plans/README.md`: remove the active row, add a
  "Recently landed plans" row.

**Acceptance:**

- `pnpm -r typecheck` / `pnpm test` / `pnpm lint` /
  `pnpm -r build` all green.
- README + CLAUDE.md edits reviewed.

## Verification (cross-phase)

Each phase's "Acceptance" block is a hard gate; in addition the
following invariants hold across the whole feature:

- **Format remains v1**: every saved document continues to stamp
  `data-annot-version="1"`. There is no v2 in the spec / code /
  test fixtures. Rich formatting + text-on-shape are absorbed
  into v1.
- **No legacy-textbox compatibility**: SVGs written by older
  Annot builds (`data-type="textbox"`, `data-text-variant`,
  `data-text` shadow) are NOT supported. The reader rejects them
  loudly. Pre-release dumps are disposable.
- **No `annot-core` DOM regressions**: the headless cycle test
  in [`packages/core/src/headless.test.ts`](../../packages/core/src/headless.test.ts)
  stays green — `rich-text-mapper.ts` is jsdom-friendly Tier B
  (no `<canvas>` / no pointer events).
- **PPTX golden stability for the uniform case**: existing
  `pptx-export.test.ts` golden does NOT change (no rich
  formatting in its seed). Rich formatting gets its own golden
  in Phase 5.
- **Tool registry symmetry**: every TextTool field that has an
  extractor has a matching writer; the existing
  `tool-registry.test.ts` symmetry check catches drift.

## Migration notes

- **Pre-release schema fluidity**: Annot has not shipped a 1.0
  release, so the schema is treated as mutable. The new
  attributes are absorbed into v1 in place; there is no v2 and
  no `if (version >= 2)` reader branch to maintain. After 1.0
  ships the schema-freeze rule from CLAUDE.md kicks in (bump
  the version on any non-additive change), but until then the
  whole text-handling redesign is one v1 amendment.
- **No backward compatibility with old text data.** Any
  document written before this plan lands — whether sitting in
  a developer's local IndexedDB / filesystem / Drive folder —
  becomes unreadable after Phase 1 ships. The reader does not
  consult `data-type="textbox"` / `data-text-variant` /
  `data-text` and we explicitly do NOT ship a one-shot migrator.
  Acceptable because Annot is pre-release and per-user dumps
  are disposable; users who care can re-snap the screenshots.
- **Plugin storage backends**: the `StorageProvider` contract
  doesn't change. Plugins receive serialized SVG / `ImageRecord`
  blobs; the format change is transparent to them. Any plugin
  that snapshotted text-bearing data using the old schema is
  affected by the same "old data unreadable" rule.
- **Forward-looking**: the same `<g data-type="shape">` skeleton
  is the natural home for **arrow labels** and **counter
  labels-with-text** (out of scope here). After this plan
  lands, those features become "give the marker tool a
  `<text>` child in its `<g>`" and "give arrows an optional
  `<text>` child anchored to the midpoint" — both are zero-
  schema-change additions because the unified skeleton already
  models them.

## Out of scope

- **Hyperlinks in text** (PowerPoint supports them; we don't
  yet need them — defer to a follow-up if user demand surfaces).
- **Text along a path** (PowerPoint's `textOnArc` / curved text;
  not part of the screenshot-annotation usecase today).
- **Bullet / numbered lists** (PowerPoint paragraph features;
  out of scope — single-paragraph runs are sufficient for
  annotation-style labels).
- **Arrow / marker labels** (the unified skeleton enables them
  later; this plan stays focused on shape-bearing text).
- **Plugin-author rich-text API** (plugins that emit text today
  go through the Tier A `ImageRecord` / `TextRun` carrier —
  forward-compatible — but a documented plugin recipe is a
  follow-up tied to the broader plugin docs work).

## Reference: existing code to read

Before starting, read these in this order:

1. [`docs/plans/_done/three-package-split.md`](./_done/three-package-split.md) — the Tier A/B/C model the new code must respect.
2. [`docs/plans/_done/property-panel-schema.md`](./_done/property-panel-schema.md) + [`docs/plans/_done/property-panel-schema-extensions.md`](./_done/property-panel-schema-extensions.md) — registry conventions for the new property controls.
3. [`docs/plans/_done/toolbar-schema.md`](./_done/toolbar-schema.md) + [`docs/plans/_done/toolbar-apply-style-to-element.md`](./_done/toolbar-apply-style-to-element.md) — registry conventions for the TextTool preset additions.
4. [`docs/plans/_done/office-paste-shared-drawing-builder.md`](./_done/office-paste-shared-drawing-builder.md) + [`docs/plans/_done/pptx-export-shared-builder-finish.md`](./_done/pptx-export-shared-builder-finish.md) — the shared-builder contract Phase 5 is downstream of.
5. [`packages/core/src/editor/text-utils.ts`](../../packages/core/src/editor/text-utils.ts) + [`packages/editor/src/tools/text-tool.ts`](../../packages/editor/src/tools/text-tool.ts) — current state.
6. [`packages/render/src/drawingml/shapes/text.ts`](../../packages/render/src/drawingml/shapes/text.ts) — current OOXML emit path.
7. [`docs/svg-format.md`](../svg-format.md) — current schema doc.

## Status log

- 2026-04-29 — Plan drafted in response to user request to
  unify Annot's text handling with PowerPoint's two patterns
  (insert-then-edit + insert-with-text) and add per-character
  formatting. Six phases scoped; OSS-side feature (no
  annot-cloud overlap per `oss-cloud-split.md` — text editing
  is the OSS product's core capability).
- 2026-04-29 — Schema-version stance updated per user feedback:
  Annot is pre-release, so the new attributes / structure are
  absorbed into `data-annot-version="1"` in place rather than
  bumping to v2. Updated §2 "SVG format stays at v1", the
  Phase 1 / Phase 3 acceptance blocks, the Verification
  invariants, and the Migration notes accordingly.
- 2026-04-29 — Backward compatibility with older Annot dumps
  dropped per user feedback. The plan no longer carries a
  legacy-textbox fallback in the reader, the `text` field on
  `AnnotationShape` is removed, and the Phase 1 createTextBox
  shim is gone. Updated §2, the Phase 1 file list / acceptance,
  the Verification invariants, the Migration notes, and Phase
  6's now-unneeded shim cleanup line.
