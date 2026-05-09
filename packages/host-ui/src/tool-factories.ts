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

import { TOOL_REGISTRY } from "@ingcreators/annot-core/editor";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import type { CanvasManager, History, SelectionManager, ToolBase } from "@ingcreators/annot-editor";
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
  /** Confirm-then-apply gate the `crop` tool calls when the user
   *  hits Enter / clicks Apply. The host (PWA / VSCode / desktop)
   *  is responsible for showing a destructive-action confirmation
   *  dialog AND for invoking `EditorShell.applyCrop(x, y, w, h)`
   *  when the user agrees. The dialog cost is a one-time UX hit
   *  per crop and is required by the destructive-mutation policy
   *  in `CLAUDE.md` ("Any 'destroy the source bitmap' feature
   *  added later — e.g. permanently apply cropping — MUST go
   *  through the same destructive-confirmation pattern …").
   *
   *  When omitted (e.g. a host that hasn't wired the dialog yet),
   *  the crop tool falls back to a session-only viewBox crop —
   *  visually correct but lost on reload, matching the pre-Phase
   *  behaviour. The omission is opt-in so existing callers stay
   *  green during the rollout. */
  applyCrop?: (x: number, y: number, w: number, h: number) => Promise<boolean>;
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
  crop: (o, { canvas, history, applyCrop }) => {
    const t = new CropTool(canvas, history, o);
    // Bind the host-supplied confirm-then-apply gate so the tool's
    // Enter / Apply path goes through the destructive-action dialog
    // instead of falling back to the viewBox-only crop. When the
    // host doesn't supply the gate, the tool's own fallback path
    // applies (session-only crop, lost on reload).
    if (applyCrop) {
      t.onCropConfirmed = applyCrop;
    }
    return t;
  },
};

/** Toolbar `ToolDef` shape — what `Toolbar` stores in its
 *  `Map<toolId, ToolDef>` after registration. The factory is bound
 *  to the toolbar's `ToolFactoryDeps` at registration time so the
 *  per-tool callsite (button click handler) can stay
 *  `def.factory(opts)`. Relocated here from the deleted
 *  `toolbar-variants.ts` (Phase 4 of `docs/plans/toolbar-schema.md`). */
export interface ToolDef {
  label: string;
  icon: string;
  factory: (opts: ToolOptions) => ToolBase;
}

/** Map an annotation element back to the toolbar id that creates it.
 *  Used for rubber-band style propagation — when the user edits an
 *  existing shape, we want to know which tool's preset should absorb
 *  that change. Returns `null` for elements the toolbar doesn't own.
 *
 *  Implemented as a thin loop over `TOOL_REGISTRY[*].variantKeyForElement`:
 *  the registry's per-tool classifier is the single source of truth,
 *  and any tool that returns a non-null variant key claims the
 *  element. The first match wins, so the registry's iteration order
 *  encodes the legacy precedence (solid-rect-redact > highlight-rect
 *  > shape-rect, etc.). */
export function toolIdForElement(el: SVGElement): string | null {
  for (const [id, entry] of Object.entries(TOOL_REGISTRY)) {
    const key = entry.variantKeyForElement?.(el);
    if (key) return id;
  }
  return null;
}
