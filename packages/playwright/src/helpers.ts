// Pure SVG-fragment builders. Since 0.2.0 these live in
// `@ingcreators/annot-annotator` (where the same primitives back
// the new annotation DSL — see
// `@ingcreators/annot-annotator`'s `bboxAnnotationsToSvg`); this
// module re-exports them so existing
// `import { rectForBoundingBox } from "@ingcreators/annot-playwright"`
// callers keep working.
//
// The marker id prefix in `arrowBetween` changed from
// `annot-pw-arrow-N` (the 0.1.0 local implementation) to
// `annot-arrow-N` (the canonical home in annot-annotator).
// Snapshot-on-SVG tests should expect this minor cosmetic delta
// alongside the 0.2.0 bump.
//
// Prefer the DSL path (`{ type: "rect", bbox, intent: "error" }`
// passed to `annotateScreenshot({ annotations })`) for new code —
// it pulls colours from the Annot design system and supports
// composite shapes like `callout` out of the box.

export {
  type ArrowOptions,
  arrowBetween,
  type BoundingBox,
  type RectOptions,
  rectForBoundingBox,
  type TextOptions,
  textAt,
} from "@ingcreators/annot-annotator";
