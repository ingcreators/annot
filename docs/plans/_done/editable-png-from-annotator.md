# Editable PNG from `@ingcreators/annot-annotator`

> **Status:** Done — landed 2026-05-21 via PRs
> [#931](https://github.com/ingcreators/annot/pull/931) (Phase 1 —
> Tier-A `xmp-bytes` primitives),
> [#932](https://github.com/ingcreators/annot/pull/932) (Phase 2 —
> `Annotator.toEditablePng()`), and the docs-tour adopter PR
> (Phase 3 — `renderAnnotatedScreen({ editable })` + spec swap).
> All four Open Questions resolved on their defaults: (a) strict
> subpath split / PNG-only Tier-A / separate `toEditablePng()`
> method / soft-convention `tags` vocabulary.
> Triggered 2026-05-21 by a question on the docs-tour-generated
> `/docs/app/` screenshot ("can the output PNG be reopened in
> Annot for re-editing?"). Answer today: yes. This plan added the
> capability without affecting the existing flat-raster path.
> **Compatibility:** Additive. New `toEditablePng()` method on
> the annotator + a new Tier-A subpath on
> `@ingcreators/annot-core/xmp`. Existing `toPng()` callers
> unaffected. The browser-side `createEditableImage` in
> `annot-core/xmp/xmp-browser.ts` keeps working (becomes a
> ~10-line wrapper around the Tier-A primitive).
> **Risk:** Low. The XMP byte-encoding logic (`buildXmp`,
> `writePngWithMetadata`, the read path) is already pure-bytes
> Tier-A — it just lives in a file that pulls in `Blob` /
> `canvas` for the surrounding wrapper. Lifting it is mostly
> mechanical.

## TL;DR

`createAnnotator().toPng({ baseImage, annotationsSvg })`
returns a flat rasterized PNG today. Opening that PNG in the
Annot editor treats it as a plain bitmap — the annotations are
"baked in" and can't be selected, moved, or restyled.

The browser-side path solves this with `createEditableImage`
in `@ingcreators/annot-core/xmp`, which writes the original
capture (un-annotated) + the annotations SVG into the PNG's
XMP metadata. The Annot editor reads that metadata back via
`readEditableImage` and reconstructs an editable document.

This plan extracts the pure-bytes half of that logic into a
Tier-A subpath (`@ingcreators/annot-core/xmp` exports
`createEditablePngBytes` + `readEditablePngBytes`) and adds a
`toEditablePng()` method on the headless annotator so:

- The Playwright docs-tour can publish editable screenshots
  that anyone can re-open in Annot Cloud (`annot.work/app/`)
  to tweak the annotations.
- MCP agents emitting screenshots via `annot_annotate_url` can
  return editable PNGs so the receiving human / agent can
  hand-tune in the editor.
- Any Node script consuming `@ingcreators/annot-annotator` —
  CI build pipelines, custom CLI tools — gets the same
  capability with one method call.

Three small PRs (Tier-A lift → annotator API → docs-tour
adoption), about half a working day end-to-end.

## Phases

| Phase | Output | Estimate |
|---|---|---|
| 1 | `annot-core/xmp` Tier-A primitives + tests | ~2 hours |
| 2 | `annot-annotator` `toEditablePng()` + tests + docs | ~2 hours |
| 3 | `docs-tour` switches to `toEditablePng()` | ~1 hour |

## Phase 1 — Tier-A primitives in `annot-core/xmp`

`packages/core/src/xmp/xmp-browser.ts` already has every
byte-level helper as a private function:

- `buildXmp(annotationsSvg, width, height, tags) → string`
- `writePngWithMetadata(pngBytes, xmpBytes, originalBytes) → Uint8Array`
- `writeJpegWithMetadata(jpegBytes, xmpBytes, originalBytes) → Uint8Array`
- The full read path (`readEditableImage`) is already pure-bytes.

Browser-only code surrounds them:

- `createEditableImage(EditableImageOptions): Promise<Blob>`
  — takes `Blob` inputs, returns `Blob`.
- `pngBlobToJpegBlob` — uses `Image` + `<canvas>` for JPEG
  conversion.
- `blobToUint8Array` — wraps `Blob.arrayBuffer()`.
- `dataUrlToUint8Array` — pure but trivially Tier-A.

**Action:** add a new file
`packages/core/src/xmp/xmp-bytes.ts` (Tier A) with:

```ts
export interface CreateEditablePngBytesOptions {
  /** Rasterised PNG bytes (the visible image) */
  renderedPng: Uint8Array;
  /** Original capture, un-annotated. PNG bytes OR data URL. */
  originalImage: Uint8Array | string;
  /** Annotations-only SVG string. */
  annotationsSvg: string;
  width: number;
  height: number;
  /** Optional kv tags. */
  tags?: Record<string, string>;
}

export function createEditablePngBytes(
  opts: CreateEditablePngBytesOptions,
): Uint8Array;

export function readEditablePngBytes(
  data: Uint8Array,
): AnnotMetadata | null;
```

JPEG output stays browser-only for now (the conversion needs
either a canvas or a Node-side image-encoding lib; not worth
adding `sharp` as a Tier-A dep just for that). Tier A handles
PNG only — that's all the docs-tour / MCP need.

Re-export from `@ingcreators/annot-core/xmp` so consumers do:

```ts
import { createEditablePngBytes, readEditablePngBytes } from "@ingcreators/annot-core/xmp";
```

Migrate `xmp-browser.ts`'s `createEditableImage` to call
`createEditablePngBytes` underneath — it becomes a ~10-line
wrapper that does `Blob → Uint8Array` + bytes-back-to-Blob.

**Tests:** port the existing 50 % of `xmp-browser.test.ts` that
doesn't depend on the DOM into `xmp-bytes.test.ts` (round-trip:
write → read → assert every field survives byte-for-byte).

## Phase 2 — `toEditablePng()` on the annotator

Add a new method to the `Annotator` interface returned by
`createAnnotator`:

```ts
interface Annotator {
  toPng(input: AnnotateInput): Promise<Buffer>;        // existing
  toSvg(input: AnnotateInput): Promise<string>;        // existing
  toEditablePng(input: EditableInput): Promise<Buffer>;  // NEW
}

interface EditableInput extends AnnotateInput {
  /**
   * Optional kv tags written into the XMP. Useful for tracking
   * provenance (e.g. `{ source: "docs-tour", screenId: "app-overview" }`).
   */
  tags?: Record<string, string>;
}
```

Implementation:

1. Rasterise the SVG over the base image via the existing
   `toPng` path → `renderedPng: Uint8Array`.
2. Resolve `baseImage` (Buffer / Uint8Array / data URL) to PNG
   bytes — the un-annotated original.
3. Read the rasterised image's dimensions from the IHDR chunk
   (or trust the input — base capture and rendered output share
   the same dimensions by construction).
4. Call `createEditablePngBytes({ renderedPng, originalImage,
   annotationsSvg, width, height, tags })`.
5. Return the result wrapped as a `Buffer` for parity with
   `toPng`.

**Tests:**

- `toEditablePng` returns PNG bytes containing the XMP iTXt
  chunk (verify via grepping the bytes for the magic header).
- Round-trip: `toEditablePng()` output → `readEditablePngBytes()`
  → original capture + annotationsSvg recovered byte-for-byte.
- The rasterised visible content is byte-identical to
  `toPng()` (the XMP write is metadata-only).

**Docs:** update `/docs/api/create-annotator` with the new
method + an example. The DSL page doesn't need updating —
this is an output-format choice, not a new annotation type.

## Phase 3 — Switch the docs-tour to `toEditablePng()`

`packages/docs-site/tests/docs/annot-app.spec.ts` currently
calls `renderAnnotatedScreen` and writes the resulting bytes
to `public/app/shots/app-overview.png`. Change to:

```ts
import { createAnnotator } from "@ingcreators/annot-annotator";
import { renderAnnotatedScreen } from "@ingcreators/annot-product-docs-astro";

// 1. Resolve overlays to a typed annotation array via the
//    Image Service's existing helpers — exported for this
//    purpose in Phase 1 (`product-docs-astro` already
//    exports `bboxAnnotationsToSvg`-equivalent through
//    `renderAnnotatedScreen`'s internal pipeline).
// 2. Call annotator.toEditablePng instead of toPng:

const result = await annotator.toEditablePng({
  baseImage: rawBytes,        // the page.screenshot() output
  annotationsSvg,             // the SVG fragment with badge primitives
  width, height,
  tags: {
    source: "docs-tour",
    screen: "app-overview",
    capturedAt: new Date().toISOString(),
  },
});
await writeFile("public/app/shots/app-overview.png", result);
```

After this lands, `https://annot.work/docs/app/shots/app-overview.png`
is reopenable in Annot Cloud — anyone can right-click "Save
image as", drop into `annot.work/app/`, and edit.

A separate question (out of scope here): should the `<Screen>`
component in the rendered Astro page link to "Open in Annot"
that pre-fills the PNG into the editor via a query param? Worth
a follow-up plan once Annot Cloud has the URL-hand-off endpoint.

## Open questions

### 1. Refactoring scope on `xmp-browser.ts`

Two flavours of the Phase 1 lift:

- **(a) Strict subpath.** Keep `xmp-browser.ts` as the
  browser-facing wrapper, add `xmp-bytes.ts` as the Tier-A
  primitive; both re-export through `@ingcreators/annot-core/xmp`
  with sub-symbol naming (`createEditableImage` browser-only,
  `createEditablePngBytes` Tier-A). One shared logic in
  `xmp-bytes`.
- **(b) Single file with isomorphic API.** Merge into a single
  `xmp.ts` whose exports accept either `Blob` or `Uint8Array`
  and return one or the other based on input type. Smaller
  surface but adds runtime type-switching.

**Default: (a).** Mirrors the Tier-A / Tier-B / Tier-C pattern
already established for `annot-core` (e.g. `annot-core` root vs
`/editor` subpath). The naming difference is a clear hint to
callers about which environment the function expects.

### 2. JPEG support

Tier-A JPEG output requires either:

- A pure-JS PNG → JPEG encoder (small but slow).
- A `sharp` Tier-A dep (fast but adds ~80 MB native dep).
- Pure-JS that delegates only the DCT to `sharp` when present
  (complicated; not worth it for the use case).

**Default: PNG only.** Defer JPEG to a follow-up plan if
demand surfaces (e.g. "I need editable JPEG for an LMS that
rejects PNG"). The docs-tour use case is PNG-only.

### 3. Method placement on `Annotator`

- **(a)** `toEditablePng(input)` — separate method.
- **(b)** `toPng(input, { editable: true })` — flag on the
  existing method.

**Default: (a).** Discoverable by IntelliSense; clearer return-
type semantics (the editable PNG has different metadata
guarantees than the flat one). The flag form would also need
TypeScript narrowing acrobatics to keep the return type
sensible.

### 4. Tags vocabulary

The `tags` field is opaque — `Record<string, string>`. Should
we standardise common keys?

**Default: yes, lightly.** Document the following as "well-
known but not validated" in the API reference:

- `source` — what produced the PNG (e.g. `"docs-tour"`,
  `"playwright-fixture"`, `"annot-mcp"`).
- `screen` — for living-product-docs, the `<Screen id>` value.
- `capturedAt` — ISO timestamp.
- `commit` — git SHA when applicable.

Validation stays opt-in on the read side; the writer just
writes whatever's in the dict.

## References

- `packages/core/src/xmp/xmp-browser.ts` — existing browser
  implementation that gets factored.
- `packages/core/src/xmp/xmp-browser.test.ts` — existing
  round-trip tests; half port to `xmp-bytes.test.ts` (Tier A),
  half stay (Blob-input shape).
- `packages/annotator/src/annotator.ts` — the `Annotator`
  interface gains `toEditablePng`.
- `packages/docs-site/tests/docs/annot-app.spec.ts` — Phase 3
  call-site swap.
- `/docs/api/create-annotator` — gains the new method.
