---
"@ingcreators/annot-product-docs": minor
---

**Annotation palette composes onto the annotated PNG** — Phase 3c
of `docs/plans/living-spec-authoring-roadmap.md`. The Astro Image
Service's `renderAnnotatedScreen` now reads the Phase 3a yaml
`annotations[]` section and bakes the full visual palette
(rect / circle / arrow / text / callout / freehand / redact /
focusMask) onto the base PNG, layered underneath the existing
numbered-badge overlays.

### New public surface — `@ingcreators/annot-product-docs`

`buildShapeAnnotationsFromYaml(annotations, boxed, dims) →
BboxAnnotation[]` maps each Phase 3a `AnnotationSpec` against the
page's `BoxedEntry[]` (from snapshot YAML or PNG XMP ElementTree)
and produces `BboxAnnotation` shapes the headless annotator's
`bboxAnnotationsToSvg` consumes. Per-variant resolution:

- **`rect`** — `match` / `coversElements[]` / `bbox`. `coversElements`
  unions the per-element bboxes into one.
- **`circle`** — match-anchored circles centre on the element bbox
  with radius defaulting to half the longer axis; `center` + `radius`
  is the free-coord form.
- **`arrow`** — endpoints can be `{ match }` (centre-to-centre) or
  `{ point }`.
- **`text`** — `anchor.position` (above / below / left / right /
  center) offsets a centred / left- / right-anchored label by 8 px
  outside the element bbox.
- **`callout`** — target = match-resolved or free-coord bbox; `at`
  is the caption position.
- **`freehand`** — passes through verbatim.
- **`redact`** — style: `solid` renders as a filled rect (default
  fill `#222222`, no stroke); `fill` / `stroke` overrides honoured.
- **`focusMask`** — cutout expands by `padding` (match-anchored);
  outer rect collapses to the supplied image dims.

Intent mapping mirrors the existing badge path
(`required → error`, `action → warning`, others pass through).

Match resolution failures are silently skipped — the drift
detector (Phase 3d) surfaces them upstream so the build keeps
producing a useful PNG even when the snapshot has drifted.

### Behaviour change — `renderAnnotatedScreen`

When `<Screen annotations="…">` resolves to a yaml carrying
`annotations[]`, the renderer composes shapes (underneath) + badges
(on top) into one SVG fragment via `svgFromBboxAnnotations`. The
cache key already includes the annotations-yaml source from
Phase 2b, so edits to the yaml bust the cached PNG without extra
bookkeeping. Pre-Phase-3 yaml files (no `annotations` key) parse
+ render unchanged.

### Compatibility

Additive. Existing callers that only use `overlays[]` see no
behaviour change. The new `buildShapeAnnotationsFromYaml` export
is opt-in.
