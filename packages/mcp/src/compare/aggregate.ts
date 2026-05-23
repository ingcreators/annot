// Re-export shim — Phase 3i of
// `docs/plans/living-spec-authoring-roadmap.md` (Phase 3
// follow-up #2). The aggregate helper relocated alongside
// `diffScreenshots` to `@ingcreators/annot-annotator`. Kept as a
// thin shim so any caller still importing `../compare/aggregate.js`
// keeps working byte-identical.

export { aggregateDiffRegions } from "@ingcreators/annot-annotator";
