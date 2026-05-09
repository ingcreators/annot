/**
 * ScratchpadPasteTool — "armed placement" tool for scratchpad items.
 *
 * Clicking a scratchpad thumbnail arms this tool (via
 * CanvasManager.setActiveTool). The cursor becomes a crosshair and the
 * user's next click on the canvas drops the item at that exact
 * position — same gesture model as drawing tools (Rectangle, Arrow, …)
 * so the mental model stays consistent.
 *
 * Escape cancels placement without inserting anything.
 */

import { moveAnnotationElement } from "@ingcreators/annot-core/editor/bake-translate";
import type { CanvasManager, History } from "@ingcreators/annot-editor";
import { ToolBase, type ToolOptions } from "@ingcreators/annot-editor";
import { parseStoredItem } from "./scratchpad-utils.js";

export class ScratchpadPasteTool extends ToolBase {
  readonly name = "ScratchpadPaste";

  #svgMarkup: string;
  #width: number;
  #height: number;
  /** Callback the host wires so the newly inserted group becomes the
   *  current selection (matching other tools' onShapeComplete flow). */
  onInsert?: (inserted: SVGElement[]) => void;

  constructor(
    canvas: CanvasManager,
    history: History,
    options: ToolOptions,
    item: { svgMarkup: string; width: number; height: number },
  ) {
    super(canvas, history, options);
    this.#svgMarkup = item.svgMarkup;
    this.#width = item.width;
    this.#height = item.height;
  }

  onPointerDown(_e: PointerEvent, pt: DOMPoint): void {
    const children = parseStoredItem(this.#svgMarkup);
    if (children.length === 0) {
      this.onShapeComplete?.();
      return;
    }

    // Drop so the item's bounding-box TOP-LEFT sits at the pointer.
    // Bbox corresponds to how it was rendered in the thumbnail, so
    // what the user sees in the palette lines up with where the item
    // lands on the canvas.
    const cx = pt.x;
    const cy = pt.y;

    // Append THEN move so the move dispatcher's `applyTransformState`
    // pivot fallback (which calls `getBBox()` for the rotated branch)
    // sees a connected element. Stored children come out of the
    // serializer with no rotation/flip data attrs (their geometry
    // already absorbed the save offset), so the move walks the
    // unrotated branch — but appending first costs nothing and keeps
    // any future "rotated stamp" feature correct.
    const inserted: SVGElement[] = [];
    for (const child of children) {
      const clone = child.cloneNode(true) as SVGElement;
      this.canvas.annotations.appendChild(clone);
      moveAnnotationElement(clone, cx, cy);
      inserted.push(clone);
    }

    this.history.save();
    // Order matters: onShapeComplete first (returns the toolbar to
    // Select mode, which clears any prior selection via Toolbar
    // #activate), then onInsert (selects the freshly-pasted shapes).
    // Reversing the order would cause the activate-clear to wipe the
    // new selection — same mistake drawing tools' onShapeComplete
    // avoids by calling #activate before selection.select(el).
    this.onShapeComplete?.(inserted[0]);
    this.onInsert?.(inserted);
  }

  onPointerMove(_e: PointerEvent, _pt: DOMPoint): void {
    // Intentionally empty — no live preview in this MVP. Adding one
    // (a ghost outline that follows the cursor) is a natural next
    // step if users ask for it.
  }

  onPointerUp(_e: PointerEvent, _pt: DOMPoint): void {
    // Placement completes on pointerdown for a crisper feel (one click
    // = one drop); pointerup is unused.
  }

  override onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      // Cancel placement — no insertion, just return to Select mode.
      this.onShapeComplete?.();
    }
  }
}
