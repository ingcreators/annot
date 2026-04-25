// Live-canvas adapter for the Tier B `ToolDOMSurface` contract. Wraps
// a CanvasManager + History pair into the three-method surface the
// tool layer depends on, keeping the implementation of "where do
// annotations get mounted" out of every concrete tool.
//
// Lives in `@ingcreators/annot-editor/tools` (not core/editor)
// because it references `CanvasManager`, which is Tier C and lives
// in this package. The contract itself stays in
// `@ingcreators/annot-core/editor/tool-lifecycle`.

import type { ToolDOMSurface } from "@ingcreators/annot-core/editor/tool-lifecycle";
import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";

/**
 * Build a `ToolDOMSurface` backed by a live CanvasManager + History
 * pair. The surface mounts every element into `canvas.annotations`
 * and routes saves into `history.save()`.
 */
export function createCanvasToolSurface(
  canvas: CanvasManager,
  history: History,
): ToolDOMSurface {
  return {
    attachDraft(el) {
      canvas.annotations.appendChild(el);
    },
    addAnnotation(el) {
      canvas.annotations.appendChild(el);
      history.save();
    },
    saveHistory() {
      history.save();
    },
  };
}
