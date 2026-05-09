# Destructive crop — bake the cropped region into the source bitmap

> **Status:** Done — landed in a single PR (post-hoc plan). This
> document captures the design + scope decisions for code archaeology.
> **Compatibility:** `@ingcreators/annot-core` (`storage/types`,
> `editor/bake-translate`, `editor/transform-utils`),
> `@ingcreators/annot-render` (`cropBitmap`),
> `@ingcreators/annot-editor` (`tools/crop-tool`),
> `@ingcreators/annot-host-ui` (`EditorShell.applyCrop`, `Toolbar`,
> `tool-factories`), every host (PWA / VSCode / Desktop) — opt-in UI
> per host.
> Schema-touching: replaces the loaded image's `originalDataUrl` with
> a cropped PNG / JPEG, updates `width` / `height` to the new
> dimensions, shifts every annotation child by `(-x, -y)` so the
> persisted SVG is anchored to the new origin. No `data-annot-version`
> bump (the on-disk SVG just shrinks; readers don't have to interpret
> a new attribute).
> **Risk:** Medium. Same destructive-irreversible-after-save shape
> as redact-burn — once the cropped-out pixels leave disk they are
> gone. Confirmation dialog + toast are part of v1's scope.

## Context

The pre-existing `CropTool` was a half-finished prototype. Two visible
problems showed up the moment a user tried it:

1. **Visual feedback was broken during the drag.** The dimming
   overlay covered the entire image (including the area inside the
   drawn rect), so the user could not see the region they were
   selecting. The code attempted a `<clipPath>`-based punch-out but
   never attached the clip-path to the overlay
   (`clip-path="none"`), leaving the half-finished implementation
   shipped to users.
2. **The crop wasn't persisted.** Pressing Enter changed the SVG
   `viewBox` and called `history.save()`, but `History` only
   snapshots `annotations.innerHTML`, so neither the viewBox nor
   the bitmap participated in undo/redo OR survived a save +
   reload. Reopening the file from the gallery showed the original
   uncropped image.

Crop is the second feature (after `applyAllRedactions`) that mutates
the source bitmap. CLAUDE.md anticipates this:

> Any "destroy the source bitmap" feature added later (e.g. a
> hypothetical "flatten all annotations" or "permanently apply
> cropping") MUST go through the same destructive-confirmation
> pattern before mutating `ImageRecord.originalDataUrl`.

So the path was already mapped: mirror redact-burn's bake-then-persist
pipeline, with a destructive-action confirmation dialog as the gate.

## Design

### Scope: full-image crop, all annotations move with the new origin

V1 crops the **entire current document** to a single user-drawn
rectangle. There is no per-element scope ("crop only the selected
shape"), no aspect-ratio lock, no preset (e.g. 16:9 / 4:3) — the
user drags a rect and the entire image + annotation tree gets
re-anchored to that rect's origin. Rationale:

- Crop is conceptually one operation per document: change "what
  region of the captured screenshot is the working canvas." The
  obvious follow-ups (aspect-ratio lock, presets) are pure UX
  features that layer on without changing the data model.
- Annotations move with the crop because cropping is a coordinate-
  system transformation on the document, not a deletion of the
  cropped-out portion. A rect labelled "user button" sitting inside
  the cropped region keeps its relationship to that pixel; an
  annotation outside the rect is dropped from view but still lives
  at its world-space position (which is now outside the new
  viewBox). Future work can offer a "delete annotations outside the
  crop" toggle if that's a real user need; v1 leaves them in place
  so undo restores them visually.

### Bake output

A single PNG (or JPEG, when the source was JPEG) data-URL containing
just the cropped sub-rectangle of the base image at native
resolution. The host then:

1. Replaces the loaded `ImageRecord`'s `originalDataUrl` with the
   new bytes, AND updates `width` / `height` to the cropped pixel
   dimensions.
2. Translates every annotation child of `<g id="annotations">` by
   `(-x, -y)` so the world-space positions land at the new origin.
3. Resets the SVG `viewBox` to `"0 0 newW newH"` so the canvas
   renders the cropped bitmap at native size.
4. Calls `storage.updateImage(path, { originalDataUrl, width,
   height, annotationsSvg, updatedAt })` to atomically persist
   the bake.
5. Saves history. `Ctrl+Z` reverts the bake within the open editor
   session; after save, the cropped-out pixels are gone for good.

### Layering with redact-burn

Crop and redact-burn share the destructive-mutation pattern but are
otherwise independent:

- Redact-burn loops over `<rect data-redact-style>` / `<image
  data-redact-style>` elements and composites each onto the base.
  Annotation positions are unchanged.
- Crop takes the rectangle the user drew, copies that sub-region
  of the base into a new canvas, AND shifts every annotation by
  `(-x, -y)`. The base image dimensions change.

Both mutate `ImageRecord.originalDataUrl`. Crop additionally
mutates `width` / `height`, which prompted extending
`ImageRecordUpdate` to include those fields.

### Tier and package placement

| Layer | Package | Symbol | Purpose |
|---|---|---|---|
| Tier A | `@ingcreators/annot-core/storage` | `ImageRecordUpdate` (extended) | Carry `width` / `height` alongside `originalDataUrl` so the bake can persist the new dimensions in one `updateImage` call. |
| Tier B | `@ingcreators/annot-core/editor/transform-utils` | `bakeLineTranslate(el, dx, dy)` | Translate `<line>` / `<g data-type="arrow">` endpoints + arrow control point in world space. The existing `bakeLineTransform` only collapses pending rotation/flip state into endpoints; this is the dedicated translation helper. |
| Tier B | `@ingcreators/annot-core/editor/bake-translate` | `bakeAnnotationsTranslate(group, dx, dy)` | Walk every direct child of an annotations group and dispatch to either the existing `bakeTranslate` (non-line shapes) or `bakeLineTranslate` (lines / arrows). The existing `bakeTranslate` skips lines by design — annotations need a wrapper that covers everything. |
| Tier C-render | `@ingcreators/annot-render` | `cropBitmap(base, x, y, w, h)` | Pure data-driven `(base, rect) → Blob`. 9-arg `drawImage` source-rect → dest-rect copy. Clamps the rect into the source dimensions; preserves JPEG mime when the base was JPEG. |
| Tier C | `@ingcreators/annot-host-ui/editor-shell` | `EditorShell.applyCrop(x, y, w, h)` | Orchestration glue: load base image → call `cropBitmap` → call `bakeAnnotationsTranslate` → swap `imageEl` href / dims / position → reset viewBox → persist via `storage.updateImage` → fire `saved` + `dirty` → save history. |
| Tier C | `@ingcreators/annot-editor/tools/crop-tool` | `CropTool` (rewrite) | Drag-to-define + dim-outside-the-crop visual feedback + Enter / Apply / Escape / Cancel keyboard + button shortcuts + `onCropConfirmed` callback the host wires to the destructive-action dialog. |
| Per-host UI | PWA / VSCode / Desktop | `Toolbar.options.applyCrop` | Each host wires `showConfirmDialog` + `EditorShell.applyCrop` into the toolbar's `applyCrop` option. The toolbar threads it through `ToolFactoryDeps` to the `CropTool` factory, which sets `tool.onCropConfirmed`. |

### Visual feedback during the drag

Single `<path>` with `fill-rule="evenodd"` carrying two subpaths:

- Outer subpath = the entire current viewBox.
- Inner subpath = the user's drawn crop rect.

`fill-rule="evenodd"` paints where a point is inside an odd number
of subpaths — i.e. inside the outer rect but NOT inside the inner
rect. The crop area stays full-brightness; everything outside is
dimmed at 50%. A second `<rect stroke-dasharray="6 4">` draws the
dashed teal outline on top so the precise edge is visible against
both light and dark image content.

A `<text>` hint anchored to the current viewBox's top-left explains
"Draw crop area, then click Apply / press Enter to confirm or
Cancel / Escape to discard" so the keyboard shortcut is
discoverable even if the user never reads documentation.

### Apply / Cancel buttons

Render via a `<foreignObject>` inside the `ui-overlay` group,
anchored to the bottom-right corner of the crop rect with a 4px
inset below. Real `<button>` elements (focus management, hover
styles, click handling) instead of hand-rolled SVG hit-testing.
Pointer events stop at the buttons (don't bubble to the canvas) so
clicking one doesn't kick off a new crop drag.

The buttons surface AFTER pointerup (not during the drag) so
they don't obscure the rubber-banding visualization. The
keyboard-driven path (Enter / Escape) is unchanged — buttons are
an opt-in discoverability aid, not a replacement for power-user
keyboard flow.

### Confirmation flow

Same shape as redact-burn:

1. User draws a rect, hits Enter / clicks Apply.
2. The CropTool calls the host-supplied `onCropConfirmed(x, y, w,
   h)` callback. The host shows `showConfirmDialog`:
   - Title: "Crop image?"
   - Body: "The image will be permanently cropped to W×H pixels.
     The pixels outside the crop region can no longer be recovered
     after the next save. Continue?"
   - Buttons: "Cancel" (default) / "Crop" (destructive style).
3. On Cancel / Esc / outside-click → return `false` → CropTool stays
   busy-locked briefly, then cleans up the overlay and the user
   can re-draw.
4. On Crop → `EditorShell.applyCrop(x, y, w, h)` runs the bake +
   persist pipeline. The host shows a transient toast: "Image
   cropped to W×H. Save to make permanent." The host's
   `savePipeline.cancelAutoSave()` (where it exists — PWA + Desktop)
   fires BEFORE `applyCrop` so a debounced annotation save can't
   PATCH a stale `originalDataUrl` over the cropped bytes.
5. History snapshot fires → host receives `dirty` + `saved` events.

### Storage notes

`ImageRecordUpdate` was extended with optional `width` / `height`
fields. BrowserStore + DesktopStore pick them up automatically via
`Object.assign(record, updates)`; GoogleDriveStore and GitHubStore
gained explicit `updates.width ?? record.width` merges in their
XMP-rebuild path (the on-network blob carries the final
dimensions). VSCode's webview proxy `updateImage` is a no-op (the
host saves on its own schedule via the `save` IPC), so the bake's
shell-side persistence call is harmless there — the mutation lands
on disk via the next host-driven save instead.

## Implementation summary

Single PR (post-hoc plan, no phase split). Files touched:

- `packages/core/src/storage/types.ts` — extend `ImageRecordUpdate`.
- `packages/core/src/editor/transform-utils.ts` — add
  `bakeLineTranslate`.
- `packages/core/src/editor/bake-translate.ts` — add
  `bakeAnnotationsTranslate`.
- `packages/render/src/crop-bitmap.ts` — new helper.
- `packages/render/src/index.ts` — re-export.
- `packages/web/src/storage/google-drive-store.ts` — propagate
  width / height through XMP rebuild + cache.
- `packages/web/src/storage/github-store.ts` — same.
- `packages/host-ui/src/editor-shell.ts` — add `applyCrop` method.
- `packages/host-ui/src/tool-factories.ts` — `ToolFactoryDeps.applyCrop`.
- `packages/host-ui/src/toolbar.ts` — `ToolbarOptions.applyCrop`.
- `packages/editor/src/tools/crop-tool.ts` — rewrite (visual
  punch-out + Apply/Cancel buttons + `onCropConfirmed` hook +
  legacy viewBox-only fallback for hosts that haven't wired the
  gate).
- `packages/web/src/app/editor-session.ts` — PWA wiring.
- `packages/vscode/src/webview/main.ts` — VSCode wiring.
- `packages/desktop/src/app/app.ts` — Desktop wiring (with
  `savePipelineRef` forward-declaration so the toolbar's `applyCrop`
  can reach the cancel-autosave gate that's only constructed
  later).

Tests added:

- `packages/core/src/editor/bake-translate.test.ts` — 4 cases for
  `bakeAnnotationsTranslate` (mixed annotation tree, line-only,
  zero-translate no-op, integration of all three).
- `packages/render/src/crop-bitmap.test.ts` — 6 cases covering the
  9-arg drawImage args, clamping, fractional rounding,
  out-of-bounds throw, zero-dim throw, JPEG-mime preservation.
- `packages/editor/src/tools/crop-tool.test.ts` — 21 cases (full
  rewrite to match the new structure: punch-out path, Apply/Cancel
  button rendering + positioning, `onCropConfirmed` gating,
  legacy fallback path).
- `packages/host-ui/src/editor-shell.test.ts` — 10 new cases for
  `applyCrop` (happy-path bake + persist + annotation translate,
  storage error re-throw, no-op edge cases, line annotation
  translation, parametric degenerate-rect rejection).

## Verification

- `pnpm -r typecheck` — clean across all 10 workspace packages.
- `pnpm exec vitest run` — 122 test files / 1834 tests passing
  (+10 from the applyCrop suite).
- `pnpm lint` (Biome) — 0 errors, 5 pre-existing warnings (none
  in changed files).
- `pnpm -r build` — all packages build (PWA, Extension, VSCode,
  Desktop).
- Visual smoke (PWA dev server):
    - Draw a crop rect on a 400×300 gradient — center stays full
      brightness, edges dim at 50%.
    - Click Apply → "Crop image?" dialog with destructive styling
      (red Crop button) → click Crop.
    - Canvas immediately shows the cropped region; toolbar / right
      panel still functional.
    - DevTools confirms `imageEl.href` swapped, viewBox =
      "0 0 200 150", IDB record's `width: 200`, `height: 150`,
      `originalDataUrl` carries the new bytes.
    - Reload the document — viewBox + dimensions still cropped, the
      bake is durable.

## Migration notes

- **No `data-annot-version` bump.** The on-disk SVG just shrinks
  (smaller viewBox, smaller embedded `<image>`, annotation
  positions translated). Older readers don't have to interpret a
  new attribute.
- **`ImageRecordUpdate` is additive.** The two new fields (`width`
  / `height`) are `Partial`-optional. Backends ignore them when
  unset; consumers that explicitly read them get the new
  dimensions on a bake.
- **No backward-compat path for the pre-fix CropTool.** The old
  viewBox-only crop never persisted, so there's no on-disk state
  to migrate from.

## Forward-looking notes

- A future "Flatten all annotations" feature (different scope —
  bake every overlay into the bitmap, not just shrink the
  rectangle) would reuse `EditorShell.applyAllRedactions`'s
  pattern with an extended classifier. Crop's `bakeAnnotationsTranslate`
  is unrelated to that feature.
- Aspect-ratio lock + preset rectangles (16:9, 4:3, social media
  formats) layer on top of `CropTool` without touching the
  EditorShell or render packages — they constrain the rect the
  user is allowed to drop. Ship as a follow-up only when there's
  a real workflow demand.
- A future "Delete annotations outside the crop" toggle could
  extend `EditorShell.applyCrop` with a flag that filters the
  annotations group BEFORE bakeAnnotationsTranslate runs. The
  current behaviour (move all, keep out-of-viewBox children
  alive for undo) is the safer default.
- The Playwright headless-annotator integration in
  `PRODUCT_DIRECTION.md` will eventually want a non-UI crop
  trigger. `cropBitmap` + `bakeAnnotationsTranslate` are the
  building blocks; wiring a Node-side call site is straightforward
  once the headless integration lands.
