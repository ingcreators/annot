# Burn redactions into the original image

> **Status:** Draft
> **Compatibility:** `@ingcreators/annot-editor`, `@ingcreators/annot-host-ui`
> (EditorShell), every host (PWA / VSCode / Desktop) — opt-in UI per host.
> Schema-touching: replaces the loaded image's `originalDataUrl` with a
> burned PNG; no `data-annot-version` bump (the on-disk SVG just loses
> its redact elements after the burn-in).
> **Risk:** Medium. The action is **irreversible after save** — the
> original pixels are gone once the new bytes are persisted. Confirmation
> dialog + a clear toast / status message are part of v1's scope, not a
> follow-up.

## Context

Today's redact tool is **overlay-only**: Mosaic / Blur / Solid bar each
render an SVG element on top of the base `<image>`. The base image
itself stays pristine — `ImageRecord.originalDataUrl` (or the equivalent
file-backed bytes) is never modified. This means:

- Anyone with access to the saved file can strip the redact `<g>` /
  `<image>` / `<rect>` elements (manually or programmatically) and
  recover the original pixels. The "redaction" is a visual mask, not a
  data deletion.
- The user feedback that surfaced the issue spelled it out plainly:
  "元画像への書き込み機能がないと、元画像が残っているのでredactの意味
  がなくなってしまう" — without writing into the source image, the
  point of redacting is lost.

The two redact-tool fixes that landed in [annot#502](https://github.com/ingcreators/annot/pull/502)
(icon set + solid-bar stroke leak) and [annot#503](https://github.com/ingcreators/annot/pull/503)
(re-bake on move / resize) made the overlay UX correct. **This plan
closes the security gap by giving the user an explicit "make this
permanent" action.**

The companion architecture context is `PRODUCT_DIRECTION.md`'s
"SVG-first" stance: today every annotation is SVG, and the underlying
bitmap is read-only from the editor's POV. Burn-in is the first feature
that **mutates the underlying bitmap**, so it deserves a clear opt-in
gesture and a clear scope boundary (only redactions get baked; arrows /
shapes / text remain editable overlays).

## Design

### Scope: redactions only, all-or-nothing per gesture

V1 burns **every** redaction in the document into the base image — no
per-element selection, no "burn arrows / shapes too" option.
Rationale:

- Redactions have a unique privacy contract that no other annotation
  type shares — they exist specifically to prevent recovery of the
  pixels behind them. Bundling them with arrows / shapes ("flatten
  everything") would force an irreversible loss of the editable arrow
  / text annotations alongside the privacy-driven loss of the original
  pixels, which is two unrelated decisions wedged into one click.
- "Burn selected redactions" adds UI complexity (multi-select state,
  partial-success messaging) that's hard to justify before we have
  evidence users want it. The all-or-nothing v1 is a building block —
  per-element selection can layer on later if a real workflow demands
  it.

Solid bars get baked as flat-fill rectangles; Mosaic / Blur use the
already-baked PNG that `redact-utils.ts` produces. We don't re-sample
the base image during the burn — the rebake gate from PR2 ensures the
embedded PNG matches the current geometry by the time burn-in runs.

### Burn output

A single PNG data-URL containing the base image plus every redact
element composited on top, at the base image's original resolution. The
host then:

1. Replaces the loaded `ImageRecord`'s `originalDataUrl` (or
   storage-backend equivalent) with the new bytes.
2. Removes the redact elements from the editor's `annotations` SVG
   group.
3. Marks the document dirty so the next save persists both changes
   together.

The CanvasManager's `imageEl.href` updates to point at the new bytes
so the live editor reflects the burn-in immediately.

### Layering

Render order on the burn canvas:

  1. Base image at `(0, 0)` at native resolution.
  2. For each redact in DOM order:
     - **Solid:** `fillRect(x, y, width, height)` with the rect's
       `fill`. Honour `data-flip` / `transform` rotation by drawing
       through a transformed canvas state (the existing `<rect>`
       supports rotation via the transform attribute the
       move-bakes-coordinates plan reserved).
     - **Mosaic / Blur:** `drawImage(blob, x, y, width, height)` with
       the embedded PNG. Mosaic / blur PNGs are already self-contained
       so no extra sampling is needed.

Rotated / flipped redactions: respect the wrapper's transform, the
same way the toolbar's Office-clipboard / PPTX paths do (the
`packages/render/src/drawingml/` builders treat rotation as an emitted
shape transform). For the burn canvas we apply the same matrix to
the canvas context before drawing the element's PNG / rect.

### Tier and package placement

- **Tier C-render** (`@ingcreators/annot-render`): the pure
  `burnRedactionsIntoCanvas(baseImage, redactEls)` helper.
  `annot-render` already owns the data-driven `ImageRecord` →
  bitmap path (`renderImageRecord`); burn-in is a sibling — it
  takes a base bitmap + a redact element list, returns a composite
  bitmap. No `annot-editor` dependency, no `CanvasManager`
  coupling.
- **Tier C** (`@ingcreators/annot-editor` /
  `@ingcreators/annot-host-ui`): the orchestration glue —
  `EditorShell.applyAllRedactions()`. Reads the base image via the
  current `CanvasManager.imageEl.href`, collects redact elements
  from the annotations group, calls the renderer, replaces the
  image href + records, removes the redact elements, dispatches
  `dirty`.
- **Per-host UI**: each host (PWA, VSCode, Desktop) decides where
  to surface the action. A shared `<annot-apply-redactions-button>`
  Lit component in `annot-host-ui` renders the action + confirm
  dialog so hosts mount one element instead of duplicating the
  flow.

### Confirmation flow

Before the burn runs:

1. The action button gates on `there is at least one redact element`
   (disabled otherwise).
2. Click opens a modal with:
   - Title: "Apply redactions to image?"
   - Body: "N redaction(s) will be permanently baked into the image.
     The original pixels under each redaction can no longer be
     recovered after the next save. Continue?"
   - Buttons: "Cancel" (default) / "Apply" (destructive style).
3. On "Apply", run the burn, replace the image, remove the redact
   elements, mark dirty, and show a transient toast: "N redaction(s)
   applied to image. The next save makes this permanent."
4. The action remains undo-able **within the editor session** (the
   redact elements + previous image href can be restored from history
   while the user has the document open) — so the user can always
   back out before saving. **After save, the original is gone.** The
   confirmation copy has to make this distinction crystal clear.

History: a single `history.save()` after the burn captures the
burned state. Standard Ctrl+Z reverts to pre-burn within the
session.

### Storage notes

The burn does NOT call `StorageProvider.updateImage` directly —
that's the host's save pipeline's job. The shell mutates in-memory
state (`ImageRecord.originalDataUrl` + the SVG annotations) and
fires `dirty`; whatever save flow the host uses (PWA's
`SavePipeline`, VSCode's `vscode.workspace.fs.writeFile`,
Desktop's filesystem-backed `DesktopStore`) picks up the change
on the next save tick.

For backends that store the bitmap separately from the SVG (Drive,
GitHub, future S3-backed plugins), the save flow already handles
"both the SVG and the base image changed since last save" — no
backend-specific glue is needed.

## Phased plan

Each phase lands as its own PR per the CLAUDE.md "phased plans:
one PR per phase" rule.

### Phase 1 — Tier C-render helper

Add `burnRedactionsIntoBitmap(base: HTMLImageElement | ImageBitmap,
redactEls: SVGElement[]): Promise<Blob>` to a new
`packages/render/src/redact-burn.ts`.

- Pure: takes a loaded base image + a redact element list.
- Builds an offscreen `<canvas>` at the base's natural dimensions.
- Walks the redact elements in DOM order, composites each according
  to its `data-redact-style`.
- Returns a PNG `Blob` (callers convert to data-URL via
  `URL.createObjectURL` or `FileReader` as needed).

Tests under happy-dom: skip the actual canvas raster (out-of-reach,
same constraint redact-tool.test.ts documents) but unit-test the
element walk + classification (solid / mosaic / blur dispatch +
rotation handling) against synthetic SVG fixtures with
`drawImage` / `fillRect` mocked. The pixel-level burn fidelity is
exercised in Phase 4's host-side integration test.

### Phase 2 — EditorShell orchestration

Add `EditorShell.applyAllRedactions(): Promise<{ count: number }>` to
`@ingcreators/annot-host-ui`:

- Snapshot the redact element list from the current annotations
  group.
- Load the current base image (via the CanvasManager's `imageEl`
  href) into an `HTMLImageElement` and await its `onload`.
- Call `burnRedactionsIntoBitmap`, get the resulting blob.
- Convert to a data-URL via `FileReader` / `URL.createObjectURL`.
- Update `CanvasManager.imageEl.href` to the new data-URL so the
  live editor reflects the burn.
- Remove the redact elements from `canvas.annotations`.
- Update the in-memory `ImageRecord.originalDataUrl` so the next
  save persists.
- Save history.
- Emit a `dirty` event.

Returns the count of redactions applied so the calling host can
toast / log appropriately.

Test: integration test under happy-dom with a tiny base image, a
single solid redact, asserting (a) the redact element is gone
afterwards, (b) the canvas's `imageEl.href` changed, (c) `dirty`
fired. The actual pixel composition is covered by the renderer's
unit tests + a manual smoke check on the dev server.

### Phase 3 — Per-host UI: PWA right-panel button

Add an "Apply redactions to image" button to the PWA's right-panel
"Actions" cluster. Visible whenever the document has at least one
redact element. Wires to a shared
`<annot-apply-redactions-dialog>` Lit component (also in
`annot-host-ui`) that renders the confirm modal described in
Design § Confirmation flow.

VSCode and Desktop UI come as Phase 6 follow-ups (each is a
~50-line addition once the shared dialog component exists).

### Phase 4 — Solid bar rotation + flip parity

Phase 1's MVP renders solid bars as axis-aligned `fillRect` calls.
Solid bars on the canvas can be rotated / flipped via the
SelectionManager's transform-utils path. Extend the renderer to
apply the wrapper's transform (rotation + flip) to the canvas
context before drawing.

Mosaic / blur already rebake on move + resize (PR2), so their
PNGs are pre-positioned correctly. Rotation / flip applied to the
wrapper still needs the same canvas-transform treatment.

Test: synthetic fixture with a 45°-rotated solid redact; assert
the burned PNG's transparent / opaque corners match the rotated
bounds (via canvas `getImageData` on a happy-dom-backed canvas
mock or, in a follow-up, a real-canvas integration test under
Playwright).

### Phase 5 — Toast + status messaging

The Phase 2 `dirty` event is not user-visible. Add a transient
status-bar toast ("N redaction(s) applied to image. Save to make
permanent.") via the existing `<annot-status-bar>` host. PWA wires
it from `applyAllRedactions().then(({ count }) => statusBar.toast(...))`.

### Phase 6 — VSCode + Desktop UI parity

Mount the shared `<annot-apply-redactions-button>` +
`<annot-apply-redactions-dialog>` in:

- VSCode: webview's right-panel actions section (mirroring the PWA
  layout — VSCode reuses the host-ui surface).
- Desktop: identical to PWA since Desktop already mounts
  `EditorShell` directly.

No host-specific code changes — just the registration call.

### Phase 7 — Cleanup + plan archival

- Move plan to `_done/`.
- Add a one-line pointer in `docs/plans/README.md`'s "Recently
  landed plans" table.
- Update `CLAUDE.md` § "Things to leave alone unless explicitly
  asked" with a note that the redact tool now has a permanent
  burn-in path (so future contributors don't add a parallel
  "destroy the source bitmap" feature without going through the
  same confirmation pattern).

## Verification

- `pnpm typecheck` clean across all 15 packages after each phase.
- `pnpm test` clean — phase-1 helper tests + phase-2 integration
  tests added in their respective phases.
- `pnpm lint` 0 new findings.
- Visual smoke (PWA dev server) at the end of phase 3:
    - Draw 2 mosaics + 1 solid bar over a gradient image.
    - Move them around (PR2 rebakes on each move so the PNGs
      reflect their final geometry).
    - Click "Apply redactions to image" → confirm dialog opens.
    - Click "Apply" → toast fires, redact elements disappear,
      canvas image visibly contains the burned regions, browser
      DevTools confirms `imageEl.href` changed.
    - Save the document → reopen from gallery → the original
      pixels under the burned regions are gone (confirmed by
      DevTools'  Network panel showing the new image bytes; an
      external `<img src="...">` test page loading the saved
      file shows only the burned content).
- Manual privacy regression check after phase 4: rotated / flipped
  solid bar burns cover the rotated bounds, not the axis-aligned
  bounds.

## Migration notes

- **No `data-annot-version` bump.** Saved files just lose their
  redact elements after a burn — older readers (no redact-tool
  awareness) handle the saved file fine because there's nothing
  redact-shaped left to misinterpret.
- **No StorageProvider change.** Burn-in mutates in-memory state;
  the host's existing save pipeline persists the new bytes.
- **No backward-compat path for previously-burned files.** Files
  saved before this plan landed never had a burn-in to recover
  from — they're either a) fully overlay-redacted (still
  recoverable, the user can re-burn) or b) plain documents (no
  redactions to bake).

## Forward-looking notes

- A future "Flatten all annotations" feature (different scope —
  every overlay, not just redactions) could reuse Phase 1's
  renderer with an extended element classifier. Keep
  `burnRedactionsIntoBitmap` named and scoped to redactions for
  now; a future plan can either rename + widen the helper or
  introduce a sibling `burnAnnotationsIntoBitmap` that walks the
  full annotation set.
- Per-element selection (burn-in only the selected redactions)
  layers cleanly on top: the orchestration in Phase 2 already
  takes a redact element list, so a "burn selection" variant is a
  new entry point that passes the SelectionManager's filtered
  list.
- The Playwright headless-annotator integration in
  `PRODUCT_DIRECTION.md` will eventually want a non-UI burn-in
  trigger (e.g. a CLI flag for "redact and flatten before
  exporting"). Phase 1's helper is the building block — wiring a
  Node-side call site comes when the headless integration lands.
