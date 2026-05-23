---
"@ingcreators/annot-product-docs": minor
---

**Astro Image Service bakes mosaic / blur redacts onto the base
PNG** — Phase 3g of `docs/plans/living-spec-authoring-roadmap.md`
(Phase 3 follow-up).

When a screen's `annotations[]` yaml carries
`redact { style: "mosaic" | "blur" }` entries, the renderer now
calls `burnRedactions` from `@ingcreators/annot-annotator` on
the base PNG before SVG-fragment composition. `style: solid`
redacts continue to flow through the existing SVG filled-rect
path — avoiding an unnecessary PNG round-trip for the common
solid case.

### New public surface

`buildRasterRedactRegionsFromYaml(annotations, boxed) →
BboxRedactRegion[]` (exported from
`@ingcreators/annot-product-docs`) walks `annotations[]` for
raster-style redact entries, resolves each cutout to a bbox,
and emits regions ready for `burnRedactions`. Match-anchored
entries whose `match` doesn't resolve are skipped silently —
the drift detector (Phase 3d) surfaces them upstream so the
build keeps producing a useful PNG while the snapshot
catches up.

### `renderAnnotatedScreen` flow

```
load base PNG bytes
   ↓
read element-tree bboxes
   ↓
walk annotations[] → split into:
   • raster redacts (mosaic / blur) → burnRedactions(base, regions)
   • SVG annotations (rect / circle / arrow / text / callout
     / freehand / solid-redact / focusMask / numberedBadge)
   ↓
compose SVG fragments on top of the (possibly burned) base PNG
   ↓
emit final PNG (flat or editable)
```

### `mapRedact` change

`mapRedact` in `mdx-annotations.ts` now returns `null` for
`style: "mosaic" | "blur"` so those entries don't double-bake
as a filled rect on top of the already-pixelated bitmap. Solid
redacts continue to produce a `BboxRectAnnotation` for the SVG
path.

### `hadBoundingBoxes` semantics

The flag flips true when raster redacts resolved through bbox
data, even when no SVG annotations composed on top. This
matches the flag's intent ("we used the snapshot's bbox data
to produce a useful render") — a screen with only a mosaic
redact still benefited from the bbox tour.

### Caching

The cache key already includes the annotations-yaml source
bytes (Phase 2b), so editing a yaml `style: mosaic` → `style:
blur` value busts the cached PNG without additional
bookkeeping.

### Compatibility

Additive. Existing screens (no `annotations[]`, or
`annotations[]` with no raster-style redacts) render
byte-identical. mosaic / blur redacts that were parser-accepted
in 3f but rendered as solid rects now render as their proper
raster effect.
