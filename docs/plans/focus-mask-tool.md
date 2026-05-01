# Focus Mask tool

> **Status:** Draft
> **Compatibility:**
>   - SVG schema gains a new top-level annotation primitive
>     (`<g data-type="focus-mask">` wrapping a single
>     `<path fill-rule="evenodd">`). Schema bumps from v1 → v2 the
>     first time a focus-mask is written.
>   - `@ingcreators/annot-core/editor/tool-options` gains
>     `MaskMode` + `CutoutShape` types and `maskMode` /
>     `maskOpacity` / `cutoutShape` fields on `ToolOptions`.
>   - `@ingcreators/annot-core` `AnnotationShape` gains a new
>     `type === "focus_mask"` discriminator with three new
>     fields (`mask_mode`, `mask_opacity`, `cutout_shape`).
>   - `@ingcreators/annot-render` gains a per-shape builder
>     `shapes/focus-mask.ts` and a dispatch arm in
>     `buildShapeXml`.
>   - `@ingcreators/annot-editor` gains a new tool class
>     `tools/focus-mask-tool.ts`.
>   - `TOOL_REGISTRY` gains a `focusMask` entry with three
>     variants (rect / rounded / ellipse) and two style modes
>     (dim / light) — total 6 logical preset buckets, but the
>     mode is a property-panel toggle, not a separate variant
>     bucket. Three preset buckets actually persisted.
> **Risk:** Phased; each phase is independently revertable. No
>     storage migration (existing saves don't contain focus
>     masks). Schema bump only takes effect for documents that
>     contain a focus mask, so legacy documents continue to load
>     unchanged. Public OOXML output adds a `type="focus_mask"`
>     case the Office-paste path now has to recognise — Tauri
>     Rust packaging side is unaffected (TS pre-builds the
>     drawing XML since the office-paste-shared-drawing-builder
>     work).

## Context

The 2026-04-30 review of `annot_designer_annotation_template.pptx`
(the in-house manual-creation reference deck) surfaced five
canonical annotation primitives the template uses: highlight
box, step-number badge, guide arrow, callout, and **focus mask**
(暗転 / 明転 — darken or lighten everything outside a region of
interest).

Annot already covers the first four:

| Template primitive | Annot tool | Status |
|---|---|---|
| ハイライト枠 (赤・角丸・枠線のみ) | `shape.rounded` | ✓ |
| ステップ番号 (青の丸型バッジ) | `marker.circle` | ✓ |
| ガイド矢印 (グレーの細線) | `arrow.end` | ✓ |
| 吹き出し (白・角丸・薄い境界線) | `text.callout` | ✓ |
| **フォーカスマスク (暗転・明転)** | **— missing —** | **this plan** |

A focus mask is the visual technique a manual author uses to
draw the reader's full attention to one part of a screenshot:
the surrounding pixels are dimmed (typically 50–60% black) or
lightened (typically 70–80% white), with a clean rectangular /
rounded / elliptical "spotlight" cut out around the target. It
is structurally distinct from `redact.solid` (which **fills**
the region of interest with a black bar — opposite semantics)
and from `highlight` (which adds a colored translucent overlay
**on top of** the region — additive, not subtractive).

The template's existence proves manual authors hand-build this
today by stacking 4 PowerPoint rectangles around the cutout
region, which is brittle (rounded corners and ellipses are
infeasible) and scales poorly across slides. Shipping a native
tool removes the workaround and makes Annot a credible
manual-authoring surface end-to-end.

## Design

### SVG representation

A focus mask is a single `<g data-type="focus-mask">` wrapping
one `<path>` that uses the SVG even-odd fill rule to render
"the whole canvas minus the cutout":

```svg
<g data-type="focus-mask"
   data-mask-mode="dim"
   data-mask-opacity="0.6"
   data-cutout-shape="rounded"
   data-cutout-x="400" data-cutout-y="200"
   data-cutout-w="400" data-cutout-h="300"
   data-cutout-r="16">
  <path
    d="M0,0 H1920 V1080 H0 Z M400,200 H800 V500 H400 Z"
    fill="#000" fill-opacity="0.6" fill-rule="evenodd"
    stroke="none"/>
</g>
```

**Attributes on the wrapper `<g>` (canonical state):**

- `data-type="focus-mask"` — discriminator for the tool router
  (parallel to `data-type="shape"`, `data-type="freehand"`,
  `data-type="arrow"`).
- `data-mask-mode="dim" | "light"` — `dim` paints `#000`
  (default), `light` paints `#fff`.
- `data-mask-opacity="0.6"` — alpha applied to the overlay
  fill. Default `0.6` for `dim`, `0.8` for `light`.
- `data-cutout-shape="rect" | "rounded" | "ellipse"` — shape
  of the spotlight. Mirrors the `shape.*` variant vocabulary
  for user-mental-model consistency.
- `data-cutout-x` / `data-cutout-y` / `data-cutout-w` /
  `data-cutout-h` — cutout AABB in canvas pixel coordinates.
- `data-cutout-r` — corner radius for `rounded`. Ignored for
  `rect` / `ellipse`. Default `16`.

**The child `<path>` is regenerated from the `data-cutout-*`
attributes + the canvas viewBox** every time the wrapper's
state changes (drag, resize, mode toggle, opacity change). The
path itself carries no canonical state — it's purely a render
artefact, like the head subpath of an arrow group. This keeps
the round-trip simple: the writer reads only `data-*` attrs;
the renderer rebuilds the path string.

**Path emission (the only non-trivial part):**

- `rect` cutout → outer rect + inner rect, two subpaths,
  six commands total. Trivial.
- `rounded` cutout → outer rect + inner rounded rect (4
  straight + 4 arc). Use `<a:arcTo>`-style absolute commands
  in SVG: `M{x+r},{y} H{x+w-r} A{r},{r} 0 0 1 {x+w},{y+r} ...`.
- `ellipse` cutout → outer rect + inner ellipse. Approximate
  via 4 cubic Beziers (the standard `c=0.5522847498` magic
  constant) so the path is a single contour without `<a:ellipse>`
  primitives. Required: a single `<path>` with even-odd fill —
  SVG's even-odd rule combines all subpaths in one element.

A small `cutout-path-utils.ts` helper in `core/editor/` builds
the d-string for any `(viewBox, cutoutShape, x, y, w, h, r)`
tuple. Pure function, jsdom-friendly, Tier B. Reused by:

- The tool's drag-creation code (live preview path).
- The tool's hand-drag / resize-handle path.
- The OOXML builder (re-uses the SAME geometry, expressed in
  EMU coords).

The wrapper `<g>` handles selection / drag / rotate / flip the
same way every other annotation does — `SelectionManager`
wraps it in handles, `transform-utils` reads `data-tx` /
`data-ty` / `data-rot`. Cutout resize handles are 8 specialised
handles **inside** the cutout rect (corners + edges), not on
the outer overlay — touching the dim area drags the wrapper as
a whole, touching inside the cutout resizes the cutout. This
is the natural affordance: the cutout is the meaningful region.

### Schema versioning

This is a new top-level annotation primitive, so
`data-annot-version` bumps from `1` → `2` the first time a
focus mask appears in a saved SVG. Loaders for v1 documents
continue unchanged (they don't encounter focus masks); loaders
for v2 documents recognise both v1 primitives and the new
focus-mask wrapper. Per CLAUDE.md guardrail #1, every focus
mask write must carry the bumped version on the SVG root.

`docs/svg-format.md` gains a new section documenting the
canonical focus-mask wrapper attribute set.

### Tool layer (Tier C)

A new `FocusMaskTool` in `packages/editor/src/tools/`:

```ts
export class FocusMaskTool extends ToolBase {
  readonly name = "focus-mask";

  // Drag a cutout rectangle. On pointer-up, materialise the wrapper
  // <g> with the current preset's mode / opacity / cutoutShape.
  onPointerDown(_e, pt) { /* start drag */ }
  onPointerMove(_e, pt) { /* live preview */ }
  onPointerUp(_e, pt) { /* finalize, save history */ }
}
```

The tool is a "drag a region" tool, behaviourally identical to
the existing rect-drag pattern in `ShapeTool`. Re-uses
`buildCutoutPath` from `core/editor/cutout-path-utils.ts` for
the live preview path.

### `ToolOptions` additions

`packages/core/src/editor/tool-options.ts`:

```ts
export type MaskMode = "dim" | "light";
export type CutoutShape = "rect" | "rounded" | "ellipse";

export interface ToolOptions {
  // ... existing fields ...

  /** Mask mode for the FocusMask tool. */
  maskMode?: MaskMode;
  /** Overlay alpha (0..1) for the FocusMask tool. */
  maskOpacity?: number;
  /** Cutout shape for the FocusMask tool. */
  cutoutShape?: CutoutShape;
  /** Corner radius (px) for cutoutShape === "rounded". */
  cutoutCornerRadius?: number;
}
```

### `TOOL_REGISTRY` entry

`packages/core/src/editor/tool-registry.ts` — new entry,
slotted between `redact` and `crop` so it appears in the
toolbar between privacy tools and the crop tool, matching the
manual-creation mental order (annotate → privacy → frame):

```ts
focusMask: {
  id: "focusMask",
  label: "Focus mask",
  icon: "spotlight_loupe", // candidate; spotlight metaphor
  variantField: "cutoutShape",
  defaultVariant: "rounded", // matches manual-template default
  variants: [
    { value: "rect",    icon: "rectangle",   label: "Rectangle", svg: SHAPE_ICON_SVG.rect    },
    { value: "rounded", icon: "crop_square", label: "Rounded",   svg: SHAPE_ICON_SVG.rounded },
    { value: "ellipse", icon: "circle",      label: "Ellipse",   svg: SHAPE_ICON_SVG.ellipse },
  ],
  presetFields: ["maskMode", "maskOpacity", "cutoutShape", "cutoutCornerRadius"],
  panelControls: [
    { section: "Type", id: "tool.typeChips" },
    { section: "Fill", id: "tool.maskMode" },        // new extra id
    { section: "Fill", id: "tool.maskOpacityPercent" }, // new extra id
    {
      section: "Fill",
      id: PROPERTY_CONTROL_IDS.cornerRadius,
      visibleWhen: (preset) => preset.cutoutShape === "rounded",
    },
  ],
  variantKeyForElement(el) {
    if (el.tagName !== "g" || el.getAttribute("data-type") !== "focus-mask") return null;
    const cs = el.getAttribute("data-cutout-shape");
    return `focusMask.${cs ?? "rounded"}`;
  },
  extractStyleFromElement(el, preset) {
    const mode = el.getAttribute("data-mask-mode");
    if (mode === "dim" || mode === "light") preset.maskMode = mode;
    const op = Number.parseFloat(el.getAttribute("data-mask-opacity") || "");
    if (Number.isFinite(op) && op >= 0 && op <= 1) preset.maskOpacity = op;
    const cs = el.getAttribute("data-cutout-shape");
    if (cs === "rect" || cs === "rounded" || cs === "ellipse") preset.cutoutShape = cs;
    const r = Number.parseFloat(el.getAttribute("data-cutout-r") || "");
    if (Number.isFinite(r) && r >= 0) preset.cutoutCornerRadius = r;
  },
  applyStyleToElement(el, preset) {
    if (preset.maskMode) el.setAttribute("data-mask-mode", preset.maskMode);
    if (preset.maskOpacity != null) {
      el.setAttribute("data-mask-opacity", String(preset.maskOpacity));
    }
    if (preset.cutoutCornerRadius != null) {
      el.setAttribute("data-cutout-r", String(preset.cutoutCornerRadius));
    }
    // Re-render the child <path> from the (now-updated) data-* attrs.
    refreshFocusMaskPath(el);
  },
},
```

`refreshFocusMaskPath` lives next to `refreshArrowPath` in
`core/editor/` (Tier B) — same pattern: pure function that
reads the wrapper's canonical attrs and rewrites the child
`<path>`'s `d` / `fill` / `fill-opacity`.

### Tool factory (Tier C)

`packages/web/src/editor/tool-factories.ts` — one entry:

```ts
focusMask: (opts, deps) => new FocusMaskTool(opts, deps),
```

### `AnnotationShape` additions

`packages/core/src/utils/tauri-bridge.ts`:

```ts
export interface AnnotationShape {
  // ... existing ...

  // ---- Focus mask variant ----
  /** When type === "focus_mask", canvas viewBox dimensions
   *  (so the OOXML builder knows how big the outer overlay
   *  rect must be — the cutout AABB rides on x/y/width/height).
   *  Populated by the writer; ignored for non-mask shapes. */
  canvas_w?: number;
  canvas_h?: number;
  /** Mask mode discriminator. */
  mask_mode?: "dim" | "light";
  /** Overlay alpha (0..1). */
  mask_opacity?: number;
  /** Cutout shape. */
  cutout_shape?: "rect" | "rounded" | "ellipse";
  /** Corner radius (px) for cutout_shape === "rounded". */
  cutout_corner_radius?: number;
}
```

`x` / `y` / `width` / `height` carry the **cutout** AABB
(not the outer overlay) so the existing `xfrmAttrs(s)` helper
remains useful for selection / drag handles. `canvas_w` /
`canvas_h` carry the outer extent.

### OOXML builder (Tier C-render)

A new `packages/render/src/drawingml/shapes/focus-mask.ts`
emits a single `<{ns}:sp>` with `<a:custGeom>` and a multi-path
`<a:pathLst>`:

```xml
<a:custGeom>
  <a:avLst/>
  <a:gdLst/>
  <a:ahLst/>
  <a:cxnLst/>
  <a:rect l="0" t="0" r="${cw}" b="${ch}"/>
  <a:pathLst>
    <a:path w="${cw}" h="${ch}">
      <!-- outer rect (full canvas) -->
      <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
      <a:lnTo><a:pt x="${cw}" y="0"/></a:lnTo>
      <a:lnTo><a:pt x="${cw}" y="${ch}"/></a:lnTo>
      <a:lnTo><a:pt x="0" y="${ch}"/></a:lnTo>
      <a:close/>
      <!-- cutout (rect / rounded / ellipse) -->
      <a:moveTo><a:pt x="${cx}" y="${cy}"/></a:moveTo>
      ... per-shape commands ...
      <a:close/>
    </a:path>
  </a:pathLst>
</a:custGeom>
<a:solidFill><a:srgbClr val="${maskHex}"><a:alpha val="${alphaPct}"/></a:srgbClr></a:solidFill>
<a:ln><a:noFill/></a:ln>
```

**Why custGeom + multi-path:** OOXML's `<a:pathLst>` accepts
multiple `<a:path>` children, and PowerPoint renders them with
even-odd fill semantics by default — **but** PowerPoint's
behaviour with multiple paths in a single `<a:path>` element
(via multiple `<a:moveTo>` / `<a:close/>` pairs) is more
reliable across versions than nesting multiple top-level
`<a:path>` elements with `fill="darken"` / `"lighten"` flags.
This plan uses **one `<a:path>` with two subpaths** (outer
contour + cutout, joined by `<a:close/> <a:moveTo>`), which
PowerPoint 2016+ renders with the correct even-odd hole.

The builder offsets the `<a:off>` to `(0, 0)` and sizes
`<a:ext>` to `(canvas_w, canvas_h)` so the outer overlay
covers the full slide. The cutout AABB on `s.x/s.y/s.width/
s.height` is rebased to local coords (subtract the offset)
before path emission. This matches how the freehand builder
rebases stroke points to its own bounding box.

**Cutout shape emission inside the custGeom:**

- `rect` → 4 `<a:lnTo>`.
- `rounded` → 4 `<a:lnTo>` + 4 `<a:arcTo>` (90° each, swing
  appropriate). `<a:arcTo>` uses `wR` / `hR` / `stAng` /
  `swAng` in 60000ths-of-a-degree (PowerPoint's angular unit).
- `ellipse` → 4 `<a:cubicBezTo>` with the 0.5522847498 magic
  constant for circle approximation. PowerPoint's `<a:arcTo>`
  is technically capable of 360°, but multi-quadrant arcs in a
  multi-path custGeom render inconsistently across versions;
  the cubic-Bezier approximation is the conservative choice.

Add a dispatch arm in `packages/render/src/drawingml/index.ts`:

```ts
case "focus_mask":
  return buildFocusMask(shape, opts.id, ns);
```

### `svg-to-annotation-shapes.ts` mapping

`packages/core/src/editor/svg-to-annotation-shapes.ts` gains a
new branch in the per-element switch (parallel to the existing
`data-type === "freehand"` and `data-type === "arrow"`
branches): when an element is `<g data-type="focus-mask">`,
emit one `AnnotationShape` with `type: "focus_mask"` and the
six new fields.

Read the canvas viewBox from the SVG root once at the top of
the walk (already done for some other primitives) and stash on
each emitted focus-mask shape's `canvas_w` / `canvas_h`. This
is the only carrier the OOXML side needs that doesn't come
from the wrapper's own attrs.

### Property panel (selection-side)

`PROPERTY_CONTROLS` in `packages/core/src/editor/property-schema.ts`
gains controls for editing a selected focus mask:

- `maskMode` — segmented control with "Dim" / "Light" options.
- `maskOpacityPercent` — slider, 0..100.
- `cutoutShape` — segmented control with rect / rounded /
  ellipse glyphs (re-uses the variant chip rendering).
- `cornerRadius` — number input, only visible when
  `cutoutShape === "rounded"`.

These also fall under the schema-driven render (Phase 2 work
will route through `renderControl` automatically once the
control defs land).

### Tool-side panel additions

Two new `ToolPanelExtraControlId` entries:

- `tool.maskMode` — the dim/light segmented control on the
  Tool side. Adapter writes `preset.maskMode`.
- `tool.maskOpacityPercent` — 0..100 slider. Adapter writes
  `preset.maskOpacity` as `percent / 100`.

The `cornerRadius` row uses the SELECTION-side control id
directly (already handles the rounded shape case for
`shape.rounded`).

## Phased plan

Each phase is a single PR, branchable independently from the
others. Phases 1 and 2 are SVG-only and ship a usable feature;
Phase 3 adds OOXML output; Phase 4 / 5 polish the UX surface;
Phase 6 archives the plan.

### Phase 1 — SVG core + tool (rect cutout, dim mode only)

Minimum viable focus mask. Drag-create a rectangular cutout,
fixed dim mode (#000 / 0.6 alpha). No property panel UI yet —
the user can drag, drag-to-resize, and delete; that's it.

**Files:**

- `packages/core/src/editor/tool-options.ts` — add `MaskMode`,
  `CutoutShape`, four new `ToolOptions` fields.
- `packages/core/src/editor/cutout-path-utils.ts` — new file,
  `buildCutoutPath(viewBox, shape, x, y, w, h, r)` returning a
  d-string. Pure / jsdom-friendly.
- `packages/core/src/editor/focus-mask-utils.ts` — new file,
  `refreshFocusMaskPath(el: SVGElement)` that reads the wrapper
  `data-*` attrs and rewrites the child `<path>`. Pure /
  jsdom-friendly.
- `packages/editor/src/tools/focus-mask-tool.ts` — new file,
  `FocusMaskTool` class.
- `packages/web/src/editor/tool-factories.ts` — add `focusMask`
  factory.
- `packages/core/src/editor/tool-registry.ts` — add `focusMask`
  registry entry. `panelControls` is `[{ section: "Type",
  id: "tool.typeChips" }]` only at this phase.
- `packages/core/src/editor/svg-to-annotation-shapes.ts` —
  `data-type="focus-mask"` short-circuits to `null` (the
  Office-paste / PPTX path silently drops focus masks at this
  phase; Phase 3 adds the real emit).
- `docs/svg-format.md` — document the canonical wrapper.
- `data-annot-version` bump to `2`. Add a focus-mask test that
  asserts the version is `2` after a write.

**Tests:**

- `cutout-path-utils.test.ts` — unit tests for the three
  shapes' d-string output.
- `focus-mask-utils.test.ts` — refresh test (mutate
  `data-cutout-w` and confirm the child path's `d` updates).
- `focus-mask-tool.test.ts` — drag-creation test under jsdom
  (synthetic pointer events, confirm a `<g data-type=
  "focus-mask">` is appended and history entry recorded).
- Storybook: `focus-mask.stories.ts` showing the rect cutout
  in two states (default position + after drag).

**Verified:** `pnpm -r typecheck`, `pnpm test`, `pnpm lint`,
`pnpm --filter @ingcreators/annot-core build`,
`pnpm --filter @ingcreators/annot-editor build`,
`pnpm --filter @ingcreators/annot-web build`.

### Phase 2 — Property panel + tool panel + variants + light mode

Variant flyout (rect / rounded / ellipse), property panel
controls (mode toggle, opacity slider, corner radius), Tool
panel side controls. After this phase the feature is
fully usable for screenshot annotation.

**Files:**

- `packages/core/src/editor/property-schema.ts` — add
  `maskMode`, `maskOpacityPercent`, `cutoutShape` to
  `PROPERTY_CONTROL_IDS`, `PROPERTY_CONTROLS`,
  `CATEGORY_CONTROL_SHAPE`. Visibility predicate filters out
  the cornerRadius control when shape ≠ "rounded".
- `packages/core/src/editor/tool-registry.ts` — extend
  `focusMask.panelControls` with the four panel rows. Add
  `flyoutKind: "variant"`, `chipColorForVariant` (none —
  defaults to the variant's `svg` field).
- `packages/core/src/editor/tool-panel-adapter.ts` — adapters
  for `tool.maskMode` and `tool.maskOpacityPercent`.
- `packages/web/src/editor/tool-property-renderer.ts` —
  declare any per-tool overrides if needed (likely none — the
  baseline label + min/max suffices).
- `packages/editor/src/property-panel.ts` — register
  `applyMaskMode` / `applyMaskOpacity` / `applyCutoutShape`
  effect handlers (Tier C — the selection-side mutations).
- `packages/web/src/editor/toolbar.ts` constructor — seed the
  initial focus-mask preset bucket so the very first click on
  the focusMask button doesn't pick up another tool's
  fillColor / strokeColor:

  ```ts
  this.#presets.set(`focusMask.rounded`, {
    ...this.#options,
    maskMode: "dim",
    maskOpacity: 0.6,
    cutoutShape: "rounded",
    cutoutCornerRadius: 16,
  });
  ```

  Same explicit-seed pattern Highlight already uses.

**Tests:**

- `property-panel-renderer.test.ts` golden additions for the
  three new controls.
- `tool-property-renderer.test.ts` golden additions for the
  three focusMask variants.
- Storybook: stories for `Default` (rounded, dim, 60%),
  `Rectangular`, `Elliptical`, `LightMode`.

### Phase 3 — OOXML output (PPTX export + Office paste)

The exporter side. After this phase, focus masks survive
copy-to-Office (Tauri desktop) and `pnpm pptx-export`
round-trip with byte-equivalent visual output.

**Files:**

- `packages/core/src/utils/tauri-bridge.ts` — add
  `canvas_w` / `canvas_h` / `mask_mode` / `mask_opacity` /
  `cutout_shape` / `cutout_corner_radius` to
  `AnnotationShape`.
- `packages/core/src/editor/svg-to-annotation-shapes.ts` —
  replace the Phase 1 short-circuit with a real emit. Read
  the SVG root's `viewBox` once per walk and populate
  `canvas_w` / `canvas_h` on each emitted focus-mask.
- `packages/render/src/drawingml/shapes/focus-mask.ts` — new
  builder file. Multi-subpath custGeom emit per the design
  section.
- `packages/render/src/drawingml/index.ts` — `case
  "focus_mask": return buildFocusMask(...)` dispatch arm.
- Update the `buildShapeXml` JSDoc to list the new type.

**Tests:**

- `packages/render/src/drawingml/drawingml.test.ts` — three
  new golden snapshots: `focus-mask-rect`,
  `focus-mask-rounded`, `focus-mask-ellipse`. Both `ns: "a"`
  (Office clipboard) and `ns: "p"` (PPTX) goldens.
- `packages/editor/src/pptx-export.test.ts` — round-trip a
  one-shape SVG containing a focus mask, confirm the
  resulting `slide1.xml` contains the expected custGeom +
  multi-path.
- Manual verification (called out in the PR's `Verified:`
  paragraph): paste into PowerPoint 2019 / 365, confirm the
  cutout renders as a transparent hole.

**Out of scope:**

- Tauri Rust crate changes. Per CLAUDE.md guardrail #5, OOXML
  emission is TS-side; the Rust crate is packaging-only since
  the office-paste-shared-drawing-builder phase 3 landed.

### Phase 4 — Right-click insert + canvas context menu

Surface focus mask in the toolbar's right-click "Insert here"
canvas context menu (the empty-canvas right-click submenu),
matching the existing pattern for shape / arrow / text /
marker / redact. The user gets to drop a focus mask at the
exact click point with a sensible default cutout size (e.g.
30% of canvas width centered on the click).

**Files:**

- `packages/web/src/editor/toolbar-canvas-menu.ts` — add a
  focusMask submenu mirror in the canvas context menu. Pulls
  variants from `TOOL_REGISTRY.focusMask`.
- `packages/web/src/editor/toolbar.ts` — `#openInsertHereMenu`
  passes the click point to the FocusMaskTool's "create at
  point" entry. Add a `createAt(pt)` method to FocusMaskTool
  for this affordance.

**Tests:**

- `toolbar-canvas-menu.test.ts` — assert focusMask appears in
  the menu with three variants.
- Storybook: a story showing the canvas menu with focusMask
  highlighted.

### Phase 5 — Manual-template preset theme polish

This phase is **not blocking the feature**; it grooms the
defaults so first-time use of focusMask matches the
manual-template visual language. It also re-evaluates the
broader preset-themes story (deferred from the 2026-04-30
review) and decides whether to ship a "Manual" theme as part
of this work or split it into a separate plan.

Outcomes (decide-during-phase, not pre-committed):

- A: Ship a "Manual" preset theme registry and a settings
  toggle. Includes focus mask defaults plus the broader
  recolouring (#666 arrow, #2563eb counter, #1a1a1a text,
  yellow highlighter freehand). Branch to a sibling plan
  `preset-themes.md`.
- B: Keep one set of defaults; tune focusMask defaults only
  to manual-template values (`maskMode: "dim"`,
  `maskOpacity: 0.6`, `cutoutShape: "rounded"`,
  `cutoutCornerRadius: 16`). Done in a single small PR.

**Recommendation:** ship B as a one-line tweak to the Phase 2
seed; spin A out as `docs/plans/preset-themes.md` if there's
demonstrated demand from the 2026-Q3 manual-creation user
testing.

### Phase 6 — Cleanup + archive

Move this plan to `_done/`, leave a one-line pointer in
`docs/plans/README.md`'s "Recently landed plans" table.
Update CLAUDE.md if any new guardrails emerged (likely a
single sentence in the section 2 table mentioning
`focusMask` as another data-driven primitive).

## Verification

End-to-end manual verification steps to perform after each
phase, beyond the per-phase unit-test additions:

1. **Phase 1**: Open the PWA, switch to Focus Mask tool,
   drag-create a rect cutout. Confirm the surrounding canvas
   dims to ~60% black with a clean transparent rectangle.
   Save the page, reopen, confirm the focus mask survives.
2. **Phase 2**: Try all 6 mode×variant combinations
   (dim / light × rect / rounded / ellipse). Confirm
   property panel controls update the live element. Switch
   `cutoutShape` mid-edit; confirm the path regenerates
   correctly.
3. **Phase 3**: Export to PPTX, open in PowerPoint 2019 +
   PowerPoint 365, confirm the cutout is transparent in
   both. Copy from Annot, paste into a Word doc and into a
   PowerPoint slide, confirm the same.
4. **Phase 4**: Right-click on empty canvas → Insert Focus
   Mask → Rounded. Confirm a focus mask materialises around
   the click point.

`pnpm -r typecheck` + `pnpm lint` (0 findings) + `pnpm test`
on every PR. `pnpm --filter @ingcreators/annot-core build` +
`-editor build` + `-render build` + `-web build` per CLAUDE
guardrail. PPTX golden snapshots committed under
`packages/render/src/drawingml/__snapshots__/` and
`packages/editor/src/__snapshots__/`.

## Migration notes

- **No data migration needed.** Existing saves don't contain
  focus masks; v1 documents continue to load unchanged.
- **Schema bump v1 → v2** is invisible to users — the bump
  only fires the first time a focus mask is written. Any
  consumer that strictly validates `data-annot-version === 1`
  should be updated to accept `>= 1` (none today; flagged
  here for OSS consumers reading the spec).
- **OOXML consumers** (rare; mostly third-party SVG-to-PPTX
  pipelines that read Annot's saved files): the new
  `type: "focus_mask"` AnnotationShape adds a case to handle.
  Unknown-type tolerance in `buildShapeXml` (returns `""`)
  means a stale consumer silently drops focus masks rather
  than crashing — the same graceful-degradation behaviour
  every other type addition has used.
- **Plugin API stability:** the `IconSpec` for the
  `focusMask` toolbar button uses a builtin Material Symbols
  glyph (`spotlight_loupe`), so no plugin-icon registration is
  required. If we later switch to a hand-rolled SVG (better
  visual weight), the spec is still backwards-compatible per
  the icon plan.
- **Forward-looking — "Spotlight series":** if focus mask
  resonates, follow-up primitives in the same family include
  blur-everything-but-region (extending Redact to spotlight
  semantics), zoom-callout (cutout magnified inset), and
  multi-cutout focus (multiple regions, single overlay). All
  three slot into the same wrapper-with-data-attrs pattern
  this plan establishes; none are required for v1 of this
  tool.
