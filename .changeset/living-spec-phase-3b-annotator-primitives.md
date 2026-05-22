---
"@ingcreators/annot-annotator": minor
---

**`BboxAnnotation` palette extensions: `freehand` + `focusMask`** —
Phase 3b of `docs/plans/living-spec-authoring-roadmap.md`.

Two new variants on the `BboxAnnotation` union expose the rest of
the Annot visual palette to `bboxAnnotationsToSvg()` and through
it to `Annotator.toPng()` / `.toSvg()` / `.toEditablePng()`:

```ts
// Free-form path stroke — `path` is the SVG <path> `d` attribute.
{
  type: "freehand",
  path: "M100,200 L150,250 L200,210",
  intent: "info",        // optional — defaults to "error"
  strokeWidth: 4,        // optional — defaults to 2
  fill: "#ffeecc",       // optional — defaults to "none"
}

// Dim everything except the cutout region. One <path> with
// fill-rule="evenodd" combines a full-image rect with the
// cutout — the even-odd rule cancels overlap.
{
  type: "focusMask",
  cutout: { x: 200, y: 100, width: 80, height: 40 },
  imageWidth: 1280,
  imageHeight: 800,
  dimColor: "rgba(0,0,0,0.5)",   // optional — default same value
}
```

`@ingcreators/annot-product-docs`'s `<Screen annotations>`
Image Service composition (Phase 3c) will map yaml
`AnnotationSpec` entries to these two primitives plus the
existing `rect` / `circle` / `arrow` / `text` / `callout` /
`numberedBadge` shapes. Useful standalone for any annotator
caller (Playwright fixtures, MCP server, custom test reporters)
without involving yaml or MDX.

**JSON schemas** — `BBOX_ANNOTATION_SCHEMA.oneOf` gains
`BBOX_FREEHAND` + `BBOX_FOCUS_MASK` entries so MCP callers can
validate either kind at the boundary.

**Out of scope** — redact (mosaic / blur) needs raster pixel
access and is not implementable as an SVG fragment; it stays
on the existing destructive `burnRedactions` path in
`@ingcreators/annot-mcp`. Phase 3a's annotation yaml rejects
`style: "mosaic" | "blur"` accordingly.

**Compatibility** — additive. Existing `BboxAnnotation` callers
keep working; the new variants are opt-in by setting
`type: "freehand" | "focusMask"`.
