---
"@ingcreators/annot-product-docs": minor
---

**Annotation yaml `redact.style` accepts `mosaic` / `blur`** —
Phase 3f of `docs/plans/living-spec-authoring-roadmap.md`
(Phase 3 follow-up).

The Phase 3a parser shipped `redact.style: "solid"` only; mosaic
/ blur were explicitly rejected with a "reserved for follow-up"
message. Phase 3f widens the enum to all three (`solid` /
`mosaic` / `blur`) so authoring tools and the Astro Image
Service can use the values end-to-end.

### Parser behaviour

```yaml
# Phase 3a: accepted
annotations:
  - id: redact-1
    kind: redact
    bbox: { x: 0, y: 0, width: 100, height: 30 }
    style: solid

# Phase 3f: NEW — both accepted
annotations:
  - id: redact-2
    kind: redact
    match: { role: textbox, name: Reason }
    style: mosaic
  - id: redact-3
    kind: redact
    bbox: { x: 421, y: 269, width: 438, height: 40 }
    style: blur
```

Unknown style values still error with an updated message:
`redact.style must be one of "solid" / "mosaic" / "blur"`.

### Render behaviour (transitional)

Between 3f (this PR) and 3g (Astro Image Service raster
pre-processing), `mosaic` and `blur` redact entries are
parser-accepted but the Image Service still routes them
through the SVG-fragment filled-rect path — so they LOOK
identical to `solid` until 3g lands. 3g wires the raster
pass that gives `mosaic` / `blur` their distinct visual
output.

### New public type

`RedactAnnotationStyle` (the `"solid" | "mosaic" | "blur"` union)
is exported from `@ingcreators/annot-product-docs` so callers
can reference it directly.

### Compatibility

Additive within v1. Pre-3f files (no redact entries, or
`style: solid` only) parse identically. Files authored with
`style: "mosaic" | "blur"` are rejected by the pre-3f parser
(loud failure pointing at the unsupported style) — consumers
on older `@ingcreators/annot-product-docs` upgrade to consume
the new files.
