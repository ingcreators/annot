// @ingcreators/annot-core/element-tree — public surface.
//
// Phase 1a of `docs/plans/living-spec-authoring-roadmap.md`.
// Tier A canonical model for "what's on this page". See `./types.ts`
// for the schema and AD-09 in the roadmap for the design rationale.

export {
  parseElementTreeFromJson,
  serializeElementTreeToJson,
  validateElementTree,
} from "./json.js";
export {
  type BBox,
  type ElementNode,
  type ElementTree,
  type ElementTreeSource,
  type ElementTreeViewport,
  isElementTreeShape,
} from "./types.js";
export {
  type ElementMatch,
  type ElementTreeVisitor,
  findByMatch,
  findByRef,
  flattenTree,
  walkTree,
} from "./walk.js";
export { parseElementTreeFromYaml, serializeElementTreeToYaml } from "./yaml.js";
