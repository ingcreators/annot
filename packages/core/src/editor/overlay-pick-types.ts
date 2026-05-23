/**
 * Shared types for the snapshot region pick flow — Phase 4d of
 * [`docs/plans/living-spec-authoring-roadmap.md`](../../../../docs/plans/living-spec-authoring-roadmap.md).
 *
 * The `<annot-snapshot-overlay>` Lit element (host-ui) and the
 * `OverlayTool` (editor) both deal with snapshot-region picks but
 * live in packages that don't depend on each other (host-ui →
 * editor, not the reverse). Lifting the detail type into Tier A
 * core lets both sides import it without forcing a cycle.
 *
 * Pure data types — no DOM, no Node-specific APIs.
 */

/**
 * Payload of the `overlay-region-pick` CustomEvent fired by
 * `<annot-snapshot-overlay>` when the user clicks a region.
 * Consumed by `OverlayTool` to build an `OverlayProposal` for the
 * intent picker dialog.
 */
export interface OverlayRegionPickDetail {
  /** Tree-unique identifier of the picked node (e.g. `"e3"`).
   *  Stable within one capture only — annotation persistence keys
   *  on `match: { role, name }` instead. */
  ref: string;
  /** ARIA role of the picked node. Always present. */
  role: string;
  /** Accessible name, when the node carries one. */
  name?: string;
  /** Page-space bounding box of the picked node. CSS px. */
  bbox: { x: number; y: number; width: number; height: number };
}
