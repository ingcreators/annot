// `@ingcreators/annot-annotator` — headless annotator API.
//
// Public surface lands in Phase 1 (the spike's loose
// `renderImageRecordToPngBytes` helper is now an internal
// implementation detail of `createAnnotator`). The package stays
// `private: true` in the workspace until Phase 3 enables Changesets
// + first npm publish.
//
// See `docs/plans/annot-annotator-package.md` for the design and
// `docs/plans/_done/headless-annotator-spike.md` for Phase 0's
// feasibility findings.

export {
  type Annotator,
  type AnnotatorInput,
  type AnnotatorOptions,
  createAnnotator,
} from "./annotator.js";
