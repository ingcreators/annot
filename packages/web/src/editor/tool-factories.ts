/**
 * Tier C — concrete tool factories. Pairs the metadata in
 * `@ingcreators/annot-core`'s `TOOL_REGISTRY` with the live-browser
 * `ToolBase` subclass each tool id instantiates.
 *
 * Factories live HERE (not in core) because they take a
 * `CanvasManager` / `History` / `SelectionManager` — all
 * `@ingcreators/annot-editor` Tier C primitives. The data ABOUT each
 * tool (id / label / icon / variants / preset fields) lives in
 * core's registry; this file is the Tier C bridge that turns
 * registry metadata into a live `ToolBase`.
 *
 * Phase 3 of `docs/plans/toolbar-schema.md`. Replaces the inline
 * `[id, label, icon, factory][]` array in `Toolbar.#registerTools()`
 * so adding a new tool is one entry in the registry + one entry
 * here, instead of an N-ary tuple wedged into a literal.
 */

import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import type {
  CanvasManager,
  History,
  SelectionManager,
  ToolBase,
} from "@ingcreators/annot-editor";
import { ArrowTool } from "@ingcreators/annot-editor/tools/arrow-tool";
import { CropTool } from "@ingcreators/annot-editor/tools/crop-tool";
import { FreehandTool } from "@ingcreators/annot-editor/tools/freehand-tool";
import { MarkerTool } from "@ingcreators/annot-editor/tools/marker-tool";
import { RedactTool } from "@ingcreators/annot-editor/tools/redact-tool";
import { ShapeTool } from "@ingcreators/annot-editor/tools/shape-tool";
import { TextTool } from "@ingcreators/annot-editor/tools/text-tool";

/** Dependencies the toolbar passes through to each factory. The
 *  shape mirrors what `Toolbar` already holds, so the construction
 *  side is just a `factory(opts, this.#deps)` call without
 *  per-tool spread. */
export interface ToolFactoryDeps {
  canvas: CanvasManager;
  history: History;
  /** Used by `text` so the post-edit `onTextBoxChanged` callback can
   *  re-select the textbox. Other tools ignore it. */
  selection: SelectionManager;
}

/** Build a live `ToolBase` for one tool id. `opts` is the
 *  ToolOptions to bind for the next draw — caller has already
 *  resolved the right preset for the tool's current variant
 *  (`Toolbar.#getCurrentPreset`). */
export type ToolFactory = (opts: ToolOptions, deps: ToolFactoryDeps) => ToolBase;

/** Map of toolId → factory. Keys MUST match the entries in
 *  `TOOL_REGISTRY`; an id present in the registry without a
 *  matching factory here is silently skipped at registration time
 *  (`Toolbar.#registerTools`) so future "metadata-only" registry
 *  entries don't crash the build. */
export const TOOL_FACTORIES: Record<string, ToolFactory> = {
  arrow: (o, { canvas, history }) => new ArrowTool(canvas, history, o),
  shape: (o, { canvas, history }) => new ShapeTool(canvas, history, o),
  highlight: (o, { canvas, history }) => {
    // Force the highlight shape regardless of any stale preset
    // state; users expect the Highlight button to always highlight.
    // Internally a ShapeTool with `shapeType="highlight"` forced on.
    o.shapeType = "highlight";
    return new ShapeTool(canvas, history, o);
  },
  text: (o, { canvas, history, selection }) => {
    const t = new TextTool(canvas, history, o);
    // After commit, re-select the resulting textbox so the
    // selection panel immediately reflects the new element.
    t.onTextBoxChanged = (el) => selection.select(el);
    return t;
  },
  freehand: (o, { canvas, history }) => new FreehandTool(canvas, history, o),
  marker: (o, { canvas, history }) => new MarkerTool(canvas, history, o),
  redact: (o, { canvas, history }) => new RedactTool(canvas, history, o),
  crop: (o, { canvas, history }) => new CropTool(canvas, history, o),
};
