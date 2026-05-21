---
"@ingcreators/annot-core": minor
"@ingcreators/annot-annotator": minor
---

**`@ingcreators/annot-annotator` — new `Annotator.toEditablePng()`
method** that returns a re-editable PNG. The bytes carry the same
visible pixels as `toPng()` plus the original un-annotated capture +
the annotations SVG embedded in the PNG's XMP / custom `svGo` chunk.
Re-opening the file in the Annot editor (or `annot.work/app/`)
restores the annotations as selectable / movable / restylable
objects rather than a flat bitmap.

```ts
const annotator = createAnnotator();
const editablePng = annotator.toEditablePng({
  originalDataUrl,
  annotationsSvg,
  width,
  height,
  tags: {
    source: "playwright-fixture",
    capturedAt: new Date().toISOString(),
  },
});
await writeFile("shot.png", editablePng);
```

Image viewers that don't know about the custom chunks display the
rasterised pixels verbatim — no compatibility loss vs `toPng()`.

The existing `toPng()` / `toSvg()` / `toEncoded()` methods are
unchanged — `toEditablePng()` is purely additive.

**`@ingcreators/annot-core` — new `/xmp-bytes` Tier-A subpath**
exposing the pure-bytes XMP encode / decode primitives that used to
live (Blob-wrapped) inside `/xmp`:

- `createEditablePngBytes(opts) -> Uint8Array` — write a re-editable
  PNG. Takes raw PNG bytes for both the rasterised image and the
  original capture; no `Blob` / `FileReader` dependency. The
  function the new `Annotator.toEditablePng()` is built on.
- `readEditablePngBytes(data) -> AnnotMetadata | null` — PNG-only
  reader.
- `readEditableImage(data) -> AnnotMetadata | null` — dual PNG /
  JPEG reader (moved here from `/xmp`, also re-exported from `/xmp`
  for source-compat).
- `WELL_KNOWN_TAG_KEYS` — soft-convention key names for the
  optional `tags` field (`source` / `screen` / `capturedAt` /
  `commit`).

Existing `@ingcreators/annot-core/xmp` consumers stay working
without source changes — `xmp-browser.ts` re-exports the Tier-A
surface alongside its Blob-wrapped `createEditableImage`.
