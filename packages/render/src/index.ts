// @ingcreators/annot-render — data-driven `ImageRecord` rendering.
//
// Phase 0 placeholder per `docs/plans/three-package-split.md`.
// The day-1 surface (`renderImageRecord`) lands in Phase 8 when
// `core/editor/export.ts` is split between this package and
// `@ingcreators/annot-editor`. Future gallery bulk-export
// functions (`exportZip`, `exportMultiSlidePptx`, etc.) and the
// eventual ImageRecord-driven `pptx-export` migration land here
// too.
//
// **Architectural invariant**: this package depends on
// `@ingcreators/annot-core` only. It MUST NOT depend on
// `@ingcreators/annot-editor` — the split exists so storage
// backends and the future gallery bulk-export view can pull
// rendering without dragging the live editor into their bundle.
// The `vite.config.ts` external list does not include
// `annot-editor` for this exact reason; if a future contributor
// adds it, that's the regression signal.

export {};
