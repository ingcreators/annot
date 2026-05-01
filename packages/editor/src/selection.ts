import {
  readArrowControl,
  readArrowEndpoints,
  refreshArrowPath,
  writeArrowControl,
} from "@ingcreators/annot-core/editor/arrow-markers";
import {
  readTextShapeSpec,
  rebuildCalloutTail,
  replaceRunsInPlace,
  setCalloutTail,
} from "@ingcreators/annot-core/editor/text-utils";
import {
  applyTransformState,
  bakeLineTransform,
  isLineLike,
  nudgeTranslate,
  readTransformState,
  setRotation,
  toggleFlip,
} from "@ingcreators/annot-core/editor/transform-utils";
import type { CanvasManager } from "./canvas-manager.js";
import type { History } from "./history.js";
import {
  cursorForAngle,
  getWorldBBox,
  HANDLE_SIZE,
  isArrowGroup,
  lineEndpointsOf,
  localToSvgPoint,
  PASTE_OFFSET,
  pointToLocal,
  rotateAround,
  SVG_NS,
  setLineEndpoints,
} from "./selection-helpers.js";
import { computeSnap, SmartGuideOverlay } from "./smart-guides.js";

export class SelectionManager {
  #canvas: CanvasManager;
  #history: History;
  #selectedSet: Set<SVGElement> = new Set();
  /** Decorative overlay nodes (outline, stems, line endpoint dots) —
   *  cleared together but never hit-tested for resize. */
  #handles: SVGRectElement[] = [];
  /** The 8 corner/edge resize squares, in canonical order
   *  (0=TL,1=TC,2=TR,3=MR,4=BR,5=BC,6=BL,7=ML). Kept separate from
   *  `#handles` so hit-testing returns indices 0..7 directly even
   *  when extra decorations (rotated outline, rotation stem, etc.)
   *  are also drawn. */
  #resizeHandles: SVGRectElement[] = [];
  #dragging = false;
  /** Overlay layer for the smart-guide dashed lines shown during a
   *  drag when the selected element's edges align with other
   *  elements. Initialized lazily on first drag. */
  #smartGuides: SmartGuideOverlay | null = null;
  /** Cached world-space bboxes of NON-selected elements for the
   *  current drag gesture. Computed once at pointer-down (they
   *  don't move during the drag) to avoid per-frame bbox cost. */
  #snapCandidates: DOMRect[] | null = null;
  #resizing = false;
  /** True once pointermove has applied at least one non-zero delta during
   *  the current drag/resize gesture. Used to distinguish a plain click
   *  (select only) from an actual drag, so plain selection does NOT
   *  push a new state to the history (which would trick the autosave
   *  indicator into flashing "Edited"). */
  #gestureChangedContent = false;
  #resizeHandle = -1;
  #startX = 0;
  #startY = 0;
  #origBBox: DOMRect | null = null;

  /** Active when the user is dragging a callout's tail-tip handle. */
  #draggingTail = false;
  /** The dedicated tail-drag handle (SVGCircleElement). Stored as a
   *  separate ref so it can be hit-tested independently of the bbox
   *  handles array. */
  #tailHandle: SVGCircleElement | null = null;

  /** Curve control-point handle for arrow `<g data-type="arrow">`.
   *  When the arrow is straight, the handle visually sits at its
   *  midpoint (hollow) — dragging it creates the curve. When curved,
   *  the handle sits at the control point (filled). Double-click to
   *  reset to straight. */
  #curveHandle: SVGCircleElement | null = null;
  /** Active during a curve-handle drag. */
  #draggingCurve = false;

  /** Active when the user is dragging the rotation handle. */
  #rotating = false;
  /** Pivot of the current rotation gesture (SVG-root coords). */
  #rotateCx = 0;
  #rotateCy = 0;
  /** Rotation at gesture start, plus the angle from pivot to pointer
   *  at start; the new rotation = startRot + (currentAngle - startAngle). */
  #rotateStartRot = 0;
  #rotateStartAngle = 0;
  /** Endpoint snapshot for line/arrow rotation gestures. When set,
   *  the rotation handler applies the angle delta to this snapshot
   *  around (#rotateCx, #rotateCy) and writes fresh endpoints — no
   *  transform attribute is touched. Null for non-line elements
   *  (which use the transform-based setRotation() path). */
  #rotateLineSnapshot: { x1: number; y1: number; x2: number; y2: number } | null = null;
  /** The rotation handle visual. Hit-tested independently of bbox
   *  handles (similar pattern to #tailHandle). */
  #rotationHandle: SVGCircleElement | null = null;

  // Marquee (rubber-band) selection
  #marquee: SVGRectElement | null = null;
  #marqueeStartX = 0;
  #marqueeStartY = 0;
  #isMarquee = false;

  // Internal clipboard
  #clipboard: string[] = []; // serialized SVG outerHTML
  #pasteCount = 0;

  /** Controls the lifetime of every DOM listener this manager attaches
   *  to the shared SVG / document. Aborting it in destroy() removes
   *  every listener in one shot, preventing accumulation across repeated
   *  editor sessions (which reuse the same #svg-root element). Without
   *  this cleanup, dragging a shape would move it once per still-alive
   *  SelectionManager — e.g. 3 past sessions → 3× visible drag speed. */
  #abort = new AbortController();

  onChange?: () => void;

  constructor(canvas: CanvasManager, history: History) {
    this.#canvas = canvas;
    this.#history = history;
    this.#setupEvents();
  }

  /** Release all DOM listeners this manager attached. Call when the
   *  editor session ends so the next session doesn't inherit phantom
   *  listeners on the shared SVG. */
  destroy(): void {
    this.#abort.abort();
    this.#selectedSet.clear();
    this.clearHandles();
  }

  get selected(): SVGElement | null {
    const arr = Array.from(this.#selectedSet);
    return arr.length === 1 ? arr[0]! : null;
  }

  get selectedElements(): SVGElement[] {
    return Array.from(this.#selectedSet);
  }

  get hasSelection(): boolean {
    return this.#selectedSet.size > 0;
  }

  select(el: SVGElement | null): void {
    this.clearHandles();
    this.#selectedSet.clear();
    if (el) {
      this.#selectedSet.add(el);
    }
    this.#drawAllHandles();
    this.#focusSVG();
    this.onChange?.();
  }

  selectMultiple(els: SVGElement[]): void {
    this.clearHandles();
    this.#selectedSet.clear();
    for (const el of els) this.#selectedSet.add(el);
    this.#drawAllHandles();
    this.#focusSVG();
    this.onChange?.();
  }

  toggleSelect(el: SVGElement): void {
    if (this.#selectedSet.has(el)) {
      this.#selectedSet.delete(el);
    } else {
      this.#selectedSet.add(el);
    }
    this.clearHandles();
    this.#drawAllHandles();
    this.onChange?.();
  }

  copySelected(): void {
    if (this.#selectedSet.size === 0) return;
    this.#clipboard = Array.from(this.#selectedSet).map((el) => el.outerHTML);
    this.#pasteCount = 0;
  }

  paste(): void {
    if (this.#clipboard.length === 0) return;
    this.#pasteCount++;
    const offset = PASTE_OFFSET * this.#pasteCount;

    const newEls: SVGElement[] = [];
    for (const html of this.#clipboard) {
      const container = document.createElementNS(SVG_NS, "g");
      container.innerHTML = html;
      const el = container.firstElementChild as SVGElement;
      if (!el) continue;

      // Offset the pasted element
      this.#moveElement(el, offset, offset);

      // Renumber counters: find max of same style, assign next
      if (el.tagName === "g" && el.hasAttribute("data-marker")) {
        this.#renumberCounter(el);
      }

      this.#canvas.annotations.appendChild(el);
      newEls.push(el);
    }

    this.#history.save();
    this.selectMultiple(newEls);
  }

  /** Assign next counter value based on same color/shape/fontSize markers already on canvas */
  #renumberCounter(g: SVGElement): void {
    const shape = g.getAttribute("data-shape") || "circle";
    const bgEl = g.querySelector("circle") || g.querySelector("rect");
    const color = bgEl?.getAttribute("fill")?.toLowerCase() || "";
    const textEl = g.querySelector("text");
    const fs = Number.parseFloat(textEl?.getAttribute("font-size") || "0");

    let max = 0;
    const existing = this.#canvas.annotations.querySelectorAll("g[data-marker]");
    for (const m of Array.from(existing)) {
      const mShape = m.getAttribute("data-shape") || "circle";
      if (mShape !== shape) continue;
      const mBg = m.querySelector("circle") || m.querySelector("rect");
      if ((mBg?.getAttribute("fill") || "").toLowerCase() !== color) continue;
      const mFs = Number.parseFloat(m.querySelector("text")?.getAttribute("font-size") || "0");
      if (Math.abs(mFs - fs) > 1) continue;
      const val = Number.parseInt(m.getAttribute("data-marker") || "0", 10);
      if (!Number.isNaN(val) && val > max) max = val;
    }

    const next = max + 1;
    g.setAttribute("data-marker", String(next));
    if (textEl) textEl.textContent = String(next);
  }

  duplicate(): void {
    this.copySelected();
    this.#pasteCount = 0;
    this.paste();
  }

  deleteSelected(): void {
    if (this.#selectedSet.size === 0) return;
    for (const el of this.#selectedSet) el.remove();
    this.clearHandles();
    this.#selectedSet.clear();
    this.#history.save();
    this.onChange?.();
  }

  // =========================================================================
  // Z-order operations
  //
  // Re-order selected elements within `#annotations`. SVG draws in
  // document order (first = back, last = front), so moving elements
  // within the children list IS moving them in z-order.
  //
  // Multi-select semantics: preserve relative order among the selected
  // elements. Absolute moves (bringToFront / sendToBack) reinsert them
  // as a contiguous block at the front / back. Step moves (bringForward
  // / sendBackward) shift each selected element by ONE position past
  // non-selected neighbors, so the selected "block" moves as a unit
  // relative to unselected siblings.
  //
  // No-ops (already at front / back) silently skip history.save so
  // undo history isn't polluted with nothing-happened steps.
  // =========================================================================

  /** Bring all selected elements to the top of the z-order (rendered
   *  last → appears on top of everything). Preserves relative order
   *  among the selected block. */
  bringToFront(): void {
    if (this.#selectedSet.size === 0) return;
    const parent = this.#canvas.annotations;
    // Iterate in current DOM order so appended block matches it.
    const ordered = this.#selectedInDomOrder();
    if (ordered.length === 0) return;
    // Already-at-front check: selected tail of children == ordered.
    if (this.#isAtFront(ordered)) return;
    for (const el of ordered) parent.appendChild(el);
    this.#history.save();
    this.refreshHandles();
    this.onChange?.();
  }

  /** Send all selected elements to the bottom of the z-order (rendered
   *  first → appears behind everything else). Preserves relative
   *  order among the selected block. */
  sendToBack(): void {
    if (this.#selectedSet.size === 0) return;
    const parent = this.#canvas.annotations;
    const ordered = this.#selectedInDomOrder();
    if (ordered.length === 0) return;
    if (this.#isAtBack(ordered)) return;
    // Insert each BEFORE the parent's original first child. Iterate
    // in REVERSE so the final DOM order matches the selected order.
    //   Before: [A, B, C, D]  selected = [B, D]
    //   Step 1 (D first): [D, A, B, C]
    //   Step 2 (B):        [B, D, A, C]   ← wrong relative order
    // Correct approach: insert BEFORE the current anchor (first
    // non-selected or the previously-inserted one), iterating selected
    // in DOM order — achieved by inserting in REVERSE iteration to
    // the first position.
    for (let i = ordered.length - 1; i >= 0; i--) {
      parent.insertBefore(ordered[i]!, parent.firstChild);
    }
    this.#history.save();
    this.refreshHandles();
    this.onChange?.();
  }

  /** Bring all selected elements forward by one step (past the next
   *  non-selected sibling). The selected block moves together. */
  bringForward(): void {
    if (this.#selectedSet.size === 0) return;
    const parent = this.#canvas.annotations;
    const children = Array.from(parent.children);
    const sel = this.#selectedSet;
    // Walk from END to START. For each selected element whose NEXT
    // sibling is NOT selected, swap them (move selected one step
    // forward). Processing end-to-start avoids interference — once
    // we swap, subsequent iterations see the updated DOM.
    let changed = false;
    for (let i = children.length - 2; i >= 0; i--) {
      const el = children[i]!;
      const next = children[i + 1]!;
      if (sel.has(el as SVGElement) && !sel.has(next as SVGElement)) {
        parent.insertBefore(next, el);
        changed = true;
      }
    }
    if (!changed) return;
    this.#history.save();
    this.refreshHandles();
    this.onChange?.();
  }

  /** Send all selected elements backward by one step (past the
   *  previous non-selected sibling). The selected block moves
   *  together. */
  sendBackward(): void {
    if (this.#selectedSet.size === 0) return;
    const parent = this.#canvas.annotations;
    const children = Array.from(parent.children);
    const sel = this.#selectedSet;
    // Walk from START to END. For each selected element whose PREV
    // sibling is NOT selected, swap (move selected one step back).
    let changed = false;
    for (let i = 1; i < children.length; i++) {
      const el = children[i]!;
      const prev = children[i - 1]!;
      if (sel.has(el as SVGElement) && !sel.has(prev as SVGElement)) {
        parent.insertBefore(el, prev);
        changed = true;
      }
    }
    if (!changed) return;
    this.#history.save();
    this.refreshHandles();
    this.onChange?.();
  }

  // =========================================================================
  // Align / Distribute
  //
  // Align: snap each selected element's bounding box edge (or center)
  // to the selection's overall bbox edge / center. Works on 2+
  // elements; a single-element call is a no-op.
  //
  // Distribute: with 3+ elements, equalize the spacing between
  // adjacent bboxes along the chosen axis so the "gaps" are uniform.
  // Leftmost and rightmost stay put; middle elements shift.
  // =========================================================================

  alignSelected(mode: "left" | "center-h" | "right" | "top" | "middle-v" | "bottom"): void {
    const targets = Array.from(this.#selectedSet) as SVGGraphicsElement[];
    if (targets.length < 2) return;
    const boxes = targets
      .map((el) => ({ el, b: this.#worldBBox(el) }))
      .filter((x): x is { el: SVGGraphicsElement; b: DOMRect } => x.b !== null);
    if (boxes.length < 2) return;

    // Overall selection bbox — reference frame for the align target.
    const selMin = {
      x: Math.min(...boxes.map(({ b }) => b.x)),
      y: Math.min(...boxes.map(({ b }) => b.y)),
    };
    const selMax = {
      x: Math.max(...boxes.map(({ b }) => b.x + b.width)),
      y: Math.max(...boxes.map(({ b }) => b.y + b.height)),
    };
    const selCx = (selMin.x + selMax.x) / 2;
    const selCy = (selMin.y + selMax.y) / 2;

    let changed = false;
    for (const { el, b } of boxes) {
      let dx = 0;
      let dy = 0;
      switch (mode) {
        case "left":
          dx = selMin.x - b.x;
          break;
        case "right":
          dx = selMax.x - (b.x + b.width);
          break;
        case "center-h":
          dx = selCx - (b.x + b.width / 2);
          break;
        case "top":
          dy = selMin.y - b.y;
          break;
        case "bottom":
          dy = selMax.y - (b.y + b.height);
          break;
        case "middle-v":
          dy = selCy - (b.y + b.height / 2);
          break;
      }
      if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
        this.#moveElement(el, dx, dy);
        changed = true;
      }
    }
    if (!changed) return;
    this.refreshHandles();
    this.#history.save();
    this.onChange?.();
  }

  distributeSelected(axis: "horizontal" | "vertical"): void {
    const targets = Array.from(this.#selectedSet) as SVGGraphicsElement[];
    if (targets.length < 3) return; // distribute needs 3+ to have a middle
    const boxes = targets
      .map((el) => ({ el, b: this.#worldBBox(el) }))
      .filter((x): x is { el: SVGGraphicsElement; b: DOMRect } => x.b !== null);
    if (boxes.length < 3) return;

    // Sort by leading edge on the chosen axis.
    boxes.sort((a, b) => (axis === "horizontal" ? a.b.x - b.b.x : a.b.y - b.b.y));

    // `boxes.length < 3` was guarded above, so both `[0]` and
    // `[length - 1]` are in range.
    const first = boxes[0]!.b;
    const last = boxes[boxes.length - 1]!.b;
    // Total span (first leading → last trailing) and sum of widths —
    // leftover is divvied into N-1 equal gaps between adjacent items.
    const totalSpan =
      axis === "horizontal" ? last.x + last.width - first.x : last.y + last.height - first.y;
    const sizeSum = boxes.reduce((s, { b }) => s + (axis === "horizontal" ? b.width : b.height), 0);
    const gap = (totalSpan - sizeSum) / (boxes.length - 1);

    let cursor =
      (axis === "horizontal" ? first.x : first.y) +
      (axis === "horizontal" ? first.width : first.height) +
      gap;
    let changed = false;
    for (let i = 1; i < boxes.length - 1; i++) {
      const { el, b } = boxes[i]!;
      const currentLead = axis === "horizontal" ? b.x : b.y;
      const delta = cursor - currentLead;
      if (Math.abs(delta) > 0.001) {
        if (axis === "horizontal") this.#moveElement(el, delta, 0);
        else this.#moveElement(el, 0, delta);
        changed = true;
      }
      cursor += (axis === "horizontal" ? b.width : b.height) + gap;
    }
    if (!changed) return;
    this.refreshHandles();
    this.#history.save();
    this.onChange?.();
  }

  /** Collect bboxes of all NON-selected annotation children — the
   *  snap targets for smart guides during drag. Cached for the
   *  duration of one gesture so per-frame cost stays O(dragged). */
  #collectSnapCandidates(): DOMRect[] {
    const out: DOMRect[] = [];
    for (const child of Array.from(this.#canvas.annotations.children)) {
      if (this.#selectedSet.has(child as SVGElement)) continue;
      const b = this.#worldBBox(child as SVGGraphicsElement);
      if (b) out.push(b);
    }
    return out;
  }

  /** World-space (viewBox coordinate) bounding box for an element.
   *  Thin wrapper around the shared `getWorldBBox` helper — it handles
   *  the SVG viewBox / viewport scale correctly, which plain
   *  `el.getCTM()` does NOT (getCTM returns screen-space, which
   *  wouldn't match the world-space coords we move elements in). */
  #worldBBox(el: SVGGraphicsElement): DOMRect | null {
    try {
      return getWorldBBox(el, this.#canvas.svg);
    } catch {
      return null;
    }
  }

  // =========================================================================
  // Group / ungroup
  // =========================================================================

  /** Wrap the selected elements in a new `<g data-type="group">`,
   *  preserving their DOM order and their current z-position (the
   *  group is inserted where the LAST selected element was). After
   *  grouping, the group becomes the new selection — users can
   *  then move / rotate / delete it as one unit. */
  groupSelected(): void {
    if (this.#selectedSet.size < 2) return;
    const parent = this.#canvas.annotations;
    const ordered = this.#selectedInDomOrder();
    if (ordered.length < 2) return;
    // Insert the group where the LAST selected element currently
    // sits, so the new group inherits its z-position (the topmost
    // of the grouped set). Keeping z-order intuitive: grouping
    // should never change the visual stacking.
    // `ordered.length < 2` was guarded above.
    const anchor = ordered[ordered.length - 1]!;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g") as SVGGElement;
    group.setAttribute("data-type", "group");
    parent.insertBefore(group, anchor);
    for (const el of ordered) group.appendChild(el);
    this.select(group);
    this.#history.save();
    this.onChange?.();
  }

  /** Unwrap any selected groups — move their children back to the
   *  parent and select the children. Non-group selections are left
   *  alone. The children keep their position in the DOM relative
   *  to the group's former spot, preserving z-order. */
  ungroupSelected(): void {
    if (this.#selectedSet.size === 0) return;
    const parent = this.#canvas.annotations;
    const targets = Array.from(this.#selectedSet).filter(
      (el) => el.tagName === "g" && el.getAttribute("data-type") === "group",
    ) as SVGGElement[];
    if (targets.length === 0) return;
    const newSelection: SVGElement[] = [];
    for (const group of targets) {
      const children = Array.from(group.children) as SVGElement[];
      for (const child of children) {
        parent.insertBefore(child, group);
        newSelection.push(child);
      }
      group.remove();
    }
    this.selectMultiple(newSelection);
    this.#history.save();
    this.onChange?.();
  }

  /** Array of selected elements in their CURRENT DOM-child order.
   *  Used by the absolute z-order moves so the block ends up
   *  contiguous in its original relative order. */
  #selectedInDomOrder(): SVGElement[] {
    const out: SVGElement[] = [];
    for (const c of Array.from(this.#canvas.annotations.children)) {
      if (this.#selectedSet.has(c as SVGElement)) out.push(c as SVGElement);
    }
    return out;
  }

  /** True if `ordered` already occupies the TRAILING N positions of
   *  the parent's children — i.e. they're all at the top already, so
   *  bringToFront would be a no-op. */
  #isAtFront(ordered: SVGElement[]): boolean {
    const children = this.#canvas.annotations.children;
    const n = ordered.length;
    for (let i = 0; i < n; i++) {
      if (children[children.length - n + i] !== ordered[i]) return false;
    }
    return true;
  }

  /** True if `ordered` already occupies the LEADING N positions of
   *  the parent's children — all at the bottom, so sendToBack is a
   *  no-op. */
  #isAtBack(ordered: SVGElement[]): boolean {
    const children = this.#canvas.annotations.children;
    for (let i = 0; i < ordered.length; i++) {
      if (children[i] !== ordered[i]) return false;
    }
    return true;
  }

  /** Move focus to SVG container so keyboard events (Delete, arrows) work */
  #focusSVG(): void {
    // Remove focus from any text/input element
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    // Make SVG focusable and focus it
    this.#canvas.svg.setAttribute("tabindex", "0");
    this.#canvas.svg.focus({ preventScroll: true });
  }

  /** Re-render the selection handles for the current selection. Call
   *  this from external mutators (e.g. PropertyPanel rotate / flip)
   *  that change a target's transform without going through the
   *  pointer-driven gestures that auto-refresh inside this class. */
  refreshHandles(): void {
    if (this.#selectedSet.size === 0) return;
    this.clearHandles();
    this.#drawAllHandles();
  }

  clearHandles(): void {
    for (const h of this.#handles) h.remove();
    this.#handles = [];
    for (const h of this.#resizeHandles) h.remove();
    this.#resizeHandles = [];
    if (this.#tailHandle) {
      this.#tailHandle.remove();
      this.#tailHandle = null;
    }
    if (this.#rotationHandle) {
      this.#rotationHandle.remove();
      this.#rotationHandle = null;
    }
    if (this.#curveHandle) {
      this.#curveHandle.remove();
      this.#curveHandle = null;
    }
  }

  #drawAllHandles(): void {
    if (this.#selectedSet.size === 0) return;
    if (this.#selectedSet.size === 1) {
      this.#drawHandles(Array.from(this.#selectedSet)[0]!);
    } else {
      // Multi-selection: draw a combined bounding box
      this.#drawGroupHandles();
    }
  }

  #drawHandles(el: SVGElement): void {
    // Lines / arrows: draw endpoint handles instead of bbox. Two DOM
    // shapes land here:
    //   <line>                       legacy direct-line elements
    //   <path data-type="arrow">     new composed-path arrows
    //                                (stem + arrow-head subpaths —
    //                                endpoints live in data-x1/x2/
    //                                y1/y2 rather than attributes).
    const isArrowPath = isArrowGroup(el);
    if (el.tagName === "line" || isArrowPath) {
      this.#drawLineHandles(el);
      this.#drawRotationHandleForLine(el);
      return;
    }
    // Rotated bbox handles — every visual handle (resize, rotation,
    // tail-tip) is computed in the element's LOCAL pre-transform frame
    // and then mapped through its CTM, so the handles track the
    // shape's actual orientation instead of an axis-aligned bounding
    // rectangle.
    this.#drawRotatedBBoxHandles(el);
    this.#drawRotationHandleAlong(el);

    // Callout tail-tip handle — drawn on top of bbox handles so the
    // user has direct control over the speech-bubble pointer. Without
    // this, the tail is locked to its initial position and the callout
    // is essentially decorative. See readTextShapeSpec for coord space.
    if (
      el.tagName === "g" &&
      el.getAttribute("data-type") === "shape" &&
      el.getAttribute("data-shape-kind") === "callout"
    ) {
      this.#drawCalloutTailHandle(el);
    }
  }

  /** Per-element rotated bbox handles. Positions follow the element's
   *  rotation/flip; each handle's cursor reflects its visual direction
   *  (sector lookup over the angle from element center to handle in
   *  screen space). */
  #drawRotatedBBoxHandles(el: SVGElement): void {
    const g = el as SVGGraphicsElement;
    if (!g.getBBox) return;
    let bb: DOMRect;
    try {
      // Text-bearing composite shapes (`<g data-type="shape">` for
      // plain / sticky / callout, plus Pattern A wrappers) clip their
      // inner `<text>` to the bg `<rect>` via `clip-path`. SVG's
      // `getBBox()` ignores clip-path, so a multi-line run that
      // overflows a freshly-shrunk box reports an unclipped text
      // bbox larger than the visible body — the selection outline +
      // resize handles then drift below the yellow body, which looks
      // like the text and the box "don't match" anymore.
      //
      // Read the bg rect (the FIRST child `<rect>`, which is also the
      // resize target in `#resizeElement`) instead so the selection
      // chrome tracks the visible body. The callout tail's tip lives
      // on its own dedicated handle, so excluding it from the bbox
      // here doesn't hide any otherwise-orphan affordance.
      if (el.tagName === "g" && el.getAttribute("data-type") === "shape") {
        const bgRect = el.querySelector("rect");
        if (bgRect) {
          bb = (bgRect as SVGGraphicsElement).getBBox();
        } else {
          bb = g.getBBox();
        }
      } else {
        bb = g.getBBox();
      }
    } catch {
      return;
    }
    const cxL = bb.x + bb.width / 2;
    const cyL = bb.y + bb.height / 2;

    // Local handle positions, indexed 0..7 in the same order the
    // resize-logic switch expects (0=TL, 1=TC, 2=TR, 3=MR, 4=BR,
    // 5=BC, 6=BL, 7=ML).
    const localPts: [number, number][] = [
      [bb.x, bb.y],
      [bb.x + bb.width / 2, bb.y],
      [bb.x + bb.width, bb.y],
      [bb.x + bb.width, bb.y + bb.height / 2],
      [bb.x + bb.width, bb.y + bb.height],
      [bb.x + bb.width / 2, bb.y + bb.height],
      [bb.x, bb.y + bb.height],
      [bb.x, bb.y + bb.height / 2],
    ];

    // Outline rectangle (rotated) drawn first so it sits BEHIND the
    // square handles. Closes the visual frame so the user reads the
    // rotated bounding box at a glance.
    // Indices 0/2/4/6 are always in range of the 8-element
    // `localPts` array constructed just above.
    const corners = [localPts[0]!, localPts[2]!, localPts[4]!, localPts[6]!].map(([x, y]) =>
      localToSvgPoint(el, new DOMPoint(x, y), this.#canvas.svg),
    );
    const outline = document.createElementNS(SVG_NS, "polygon");
    outline.setAttribute("points", corners.map((p) => `${p.x},${p.y}`).join(" "));
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", "#00d4ff");
    outline.setAttribute("stroke-width", String(1 / this.#canvas.zoom));
    outline.style.pointerEvents = "none";
    this.#canvas.uiOverlay.appendChild(outline);
    this.#handles.push(outline as unknown as SVGRectElement);

    // Cursor direction is derived from each handle's CANONICAL position
    // (TL=NW, TC=N, …) plus the element's rotation / flip — NOT from the
    // screen-space angle of (handle - center). The latter looked correct
    // for square shapes but, for a wide-and-short rectangle (a 200×80
    // sticky note is the canonical case), the geometric angle from
    // center to TL leans closer to W than to NW, so all four corners
    // ended up bucketed into ew-resize. Using the index-keyed angle
    // decouples cursor pick from the bbox aspect ratio. (Indices follow
    // the resize-logic order: 0=TL, 1=TC, 2=TR, 3=MR, 4=BR, 5=BC,
    // 6=BL, 7=ML — same ordering `localPts` uses above.)
    const LOCAL_HANDLE_ANGLES = [
      (Math.PI * 5) / 4, // 0 TL → NW
      (Math.PI * 3) / 2, // 1 TC → N
      (Math.PI * 7) / 4, // 2 TR → NE
      0, // 3 MR → E
      Math.PI / 4, // 4 BR → SE
      Math.PI / 2, // 5 BC → S
      (Math.PI * 3) / 4, // 6 BL → SW
      Math.PI, // 7 ML → W
    ];
    const tState = readTransformState(el);
    const rotRad = (tState.rotation * Math.PI) / 180;

    const hs = HANDLE_SIZE / this.#canvas.zoom;
    for (let i = 0; i < localPts.length; i++) {
      const [lx, ly] = localPts[i]!;
      const sp = localToSvgPoint(el, new DOMPoint(lx, ly), this.#canvas.svg);
      // Canonical local angle for this handle index, reflected by any
      // active flip(s) so a horizontally-flipped shape's TL handle (now
      // visually at the TR position) shows the NE diagonal cursor, not
      // the NW one.
      let cursorAng = LOCAL_HANDLE_ANGLES[i]!;
      if (tState.flipH) cursorAng = Math.PI - cursorAng;
      if (tState.flipV) cursorAng = -cursorAng;
      cursorAng += rotRad;
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(sp.x - hs / 2));
      rect.setAttribute("y", String(sp.y - hs / 2));
      rect.setAttribute("width", String(hs));
      rect.setAttribute("height", String(hs));
      rect.setAttribute("fill", "#00d4ff");
      rect.setAttribute("stroke", "#fff");
      rect.setAttribute("stroke-width", String(1 / this.#canvas.zoom));
      rect.style.cursor = cursorForAngle(cursorAng);
      rect.style.pointerEvents = "all";
      this.#canvas.uiOverlay.appendChild(rect);
      this.#resizeHandles.push(rect);
    }
  }

  /** Rotation handle that sits perpendicular to the LOCAL top edge of
   *  the element, mapped through CTM. Replaces the screen-axis-aligned
   *  variant (which sat above the AABB rather than above the visual
   *  top of a rotated shape). */
  #drawRotationHandleAlong(el: SVGElement): void {
    const g = el as SVGGraphicsElement;
    if (!g.getBBox) return;
    let bb: DOMRect;
    try {
      bb = g.getBBox();
    } catch {
      return;
    }
    const cxL = bb.x + bb.width / 2;

    // The top-center anchor in local coords. We want the handle a
    // fixed SCREEN distance above it (perpendicular to the local top
    // edge in screen space), so compute two reference points and use
    // their screen-space normal.
    const topMid = localToSvgPoint(el, new DOMPoint(cxL, bb.y), this.#canvas.svg);
    const botMid = localToSvgPoint(el, new DOMPoint(cxL, bb.y + bb.height), this.#canvas.svg);
    const dx = topMid.x - botMid.x;
    const dy = topMid.y - botMid.y;
    const len = Math.hypot(dx, dy) || 1;
    const offset = 22 / this.#canvas.zoom;
    const ux = dx / len;
    const uy = dy / len;
    const hx = topMid.x + ux * offset;
    const hy = topMid.y + uy * offset;

    // Stem
    const stem = document.createElementNS(SVG_NS, "line");
    stem.setAttribute("x1", String(topMid.x));
    stem.setAttribute("y1", String(topMid.y));
    stem.setAttribute("x2", String(hx));
    stem.setAttribute("y2", String(hy));
    stem.setAttribute("stroke", "#00d4ff");
    stem.setAttribute("stroke-width", String(1 / this.#canvas.zoom));
    stem.style.pointerEvents = "none";
    this.#canvas.uiOverlay.appendChild(stem);
    this.#handles.push(stem as unknown as SVGRectElement);

    // Handle
    const r = (HANDLE_SIZE / this.#canvas.zoom) * 0.7;
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(hx));
    circle.setAttribute("cy", String(hy));
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", "#00d4ff");
    circle.setAttribute("stroke", "#fff");
    circle.setAttribute("stroke-width", String(1.5 / this.#canvas.zoom));
    circle.style.cursor = "grab";
    circle.style.pointerEvents = "all";
    this.#canvas.uiOverlay.appendChild(circle);
    this.#rotationHandle = circle;
  }

  /** Rotation handle — small circle floating ~20px above the bbox top
   *  midpoint, connected by a stem so the affordance reads as
   *  "rotate around bbox center". Same idea as Figma / PowerPoint. */
  #drawRotationHandle(bbox: DOMRect): void {
    const cx = bbox.x + bbox.width / 2;
    const topY = bbox.y;
    const offset = 22 / this.#canvas.zoom;
    const handleY = topY - offset;

    // Stem
    const stem = document.createElementNS(SVG_NS, "line");
    stem.setAttribute("x1", String(cx));
    stem.setAttribute("y1", String(topY));
    stem.setAttribute("x2", String(cx));
    stem.setAttribute("y2", String(handleY));
    stem.setAttribute("stroke", "#00d4ff");
    stem.setAttribute("stroke-width", String(1 / this.#canvas.zoom));
    stem.style.pointerEvents = "none";
    this.#canvas.uiOverlay.appendChild(stem);
    this.#handles.push(stem as unknown as SVGRectElement);

    // Handle
    const r = (HANDLE_SIZE / this.#canvas.zoom) * 0.7;
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(handleY));
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", "#00d4ff");
    circle.setAttribute("stroke", "#fff");
    circle.setAttribute("stroke-width", String(1.5 / this.#canvas.zoom));
    circle.style.cursor = "grab";
    circle.style.pointerEvents = "all";
    this.#canvas.uiOverlay.appendChild(circle);
    this.#rotationHandle = circle;
  }

  /** For lines/arrows the bbox above doesn't apply; place the rotation
   *  handle perpendicular to the line at its midpoint. */
  #drawRotationHandleForLine(el: SVGElement): void {
    const { x1, y1, x2, y2 } = lineEndpointsOf(el);
    // Apply the line's own transform (if any) to get visual midpoint.
    const m1 = localToSvgPoint(el, new DOMPoint(x1, y1), this.#canvas.svg);
    const m2 = localToSvgPoint(el, new DOMPoint(x2, y2), this.#canvas.svg);
    const mx = (m1.x + m2.x) / 2;
    const my = (m1.y + m2.y) / 2;
    const dx = m2.x - m1.x;
    const dy = m2.y - m1.y;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular unit vector
    const px = -dy / len;
    const py = dx / len;
    const off = 22 / this.#canvas.zoom;
    const hx = mx + px * off;
    const hy = my + py * off;
    const r = (HANDLE_SIZE / this.#canvas.zoom) * 0.7;

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(hx));
    circle.setAttribute("cy", String(hy));
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", "#00d4ff");
    circle.setAttribute("stroke", "#fff");
    circle.setAttribute("stroke-width", String(1.5 / this.#canvas.zoom));
    circle.style.cursor = "grab";
    circle.style.pointerEvents = "all";
    this.#canvas.uiOverlay.appendChild(circle);
    this.#rotationHandle = circle;
  }

  /** Distinct visual treatment (slightly bigger, accent-colored circle)
   *  so the tail handle reads as a different control from the resize
   *  squares. Position = local tail coords mapped through the textbox's
   *  CTM (so rotation/flip move the handle along with the visual). */
  #drawCalloutTailHandle(g: SVGElement): void {
    const tailXRaw = g.getAttribute("data-tail-x");
    const tailYRaw = g.getAttribute("data-tail-y");
    if (tailXRaw == null || tailYRaw == null) return;
    const local = new DOMPoint(Number.parseFloat(tailXRaw), Number.parseFloat(tailYRaw));
    const p = localToSvgPoint(g, local, this.#canvas.svg);
    const cx = p.x;
    const cy = p.y;
    const r = (HANDLE_SIZE / this.#canvas.zoom) * 0.75;

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", "#ff7a00");
    circle.setAttribute("stroke", "#fff");
    circle.setAttribute("stroke-width", String(1.5 / this.#canvas.zoom));
    circle.style.cursor = "move";
    circle.style.pointerEvents = "all";
    this.#canvas.uiOverlay.appendChild(circle);
    this.#tailHandle = circle;
  }

  #drawLineHandles(el: SVGElement): void {
    const { x1, y1, x2, y2 } = lineEndpointsOf(el);
    const hs = HANDLE_SIZE / this.#canvas.zoom;

    // Endpoints live in the line's LOCAL coord space. When the line
    // has a transform (rotation/flip), the visual position differs —
    // map each endpoint through the line's CTM so the handle dots sit
    // exactly where the user sees the arrow start/end.
    const localPts: [number, number][] = [
      [x1, y1],
      [x2, y2],
    ];
    for (const [lx, ly] of localPts) {
      const sp = localToSvgPoint(el, new DOMPoint(lx, ly), this.#canvas.svg);
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", String(sp.x));
      circle.setAttribute("cy", String(sp.y));
      circle.setAttribute("r", String(hs / 1.5));
      circle.setAttribute("fill", "#00d4ff");
      circle.setAttribute("stroke", "#fff");
      circle.setAttribute("stroke-width", String(1 / this.#canvas.zoom));
      circle.style.cursor = "move";
      circle.style.pointerEvents = "all";
      this.#canvas.uiOverlay.appendChild(circle);
      // Endpoint dots feed the same resize-hit-test path as bbox
      // squares (handle indices 0=start, 1=end, consumed by the line
      // branch of #resizeElement).
      this.#resizeHandles.push(circle as unknown as SVGRectElement);
    }

    // Curve control-point handle (arrow groups only). When the arrow
    // is straight, this sits at its midpoint and appears as a hollow
    // small circle — dragging it creates a curve. When curved, it
    // sits at the control point and appears filled. Double-click to
    // straighten.
    if (isArrowGroup(el)) {
      const control = readArrowControl(el);
      const [lx, ly] = control ? [control.x, control.y] : [(x1 + x2) / 2, (y1 + y2) / 2];
      const sp = localToSvgPoint(el, new DOMPoint(lx, ly), this.#canvas.svg);
      const r = hs / 1.8;
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", String(sp.x));
      circle.setAttribute("cy", String(sp.y));
      circle.setAttribute("r", String(r));
      circle.setAttribute("fill", control ? "#00d4ff" : "#fff");
      circle.setAttribute("stroke", "#00d4ff");
      circle.setAttribute("stroke-width", String(1.5 / this.#canvas.zoom));
      circle.style.cursor = "move";
      circle.style.pointerEvents = "all";
      circle.setAttribute("data-curve-handle", "1");
      // Double-click resets the arrow to straight. Only meaningful
      // when currently curved; on a straight arrow it's a no-op.
      circle.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        if (!isArrowGroup(el)) return;
        if (!readArrowControl(el)) return;
        writeArrowControl(el, null);
        refreshArrowPath(el);
        this.clearHandles();
        this.#drawAllHandles();
        this.#history.save();
      });
      this.#canvas.uiOverlay.appendChild(circle);
      this.#curveHandle = circle;
    }
  }

  #drawGroupHandles(): void {
    const sw = 1 / this.#canvas.zoom;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    // Per-element subtle outline so the user can visually identify
    // WHICH elements are selected — with the combined group bbox alone,
    // multi-select can read as "one merged shape", making it unclear
    // that align/distribute etc. operate on individual elements.
    // Thin, no handles, same accent color as the group bbox.
    for (const el of this.#selectedSet) {
      const bbox = getWorldBBox(el, this.#canvas.svg);
      if (!bbox) continue;
      minX = Math.min(minX, bbox.x);
      minY = Math.min(minY, bbox.y);
      maxX = Math.max(maxX, bbox.x + bbox.width);
      maxY = Math.max(maxY, bbox.y + bbox.height);
      const elOutline = document.createElementNS(SVG_NS, "rect");
      elOutline.setAttribute("x", String(bbox.x));
      elOutline.setAttribute("y", String(bbox.y));
      elOutline.setAttribute("width", String(bbox.width));
      elOutline.setAttribute("height", String(bbox.height));
      elOutline.setAttribute("fill", "none");
      elOutline.setAttribute("stroke", "#00d4ff");
      elOutline.setAttribute("stroke-width", String(sw));
      elOutline.setAttribute("stroke-opacity", "0.7");
      elOutline.style.pointerEvents = "none";
      this.#canvas.uiOverlay.appendChild(elOutline);
      this.#handles.push(elOutline as any);
    }
    if (!Number.isFinite(minX)) return;

    // Combined group bbox — dashed outline to distinguish from the
    // per-element solid outlines. Acts as the anchor for the 8
    // resize handles so users can scale the whole group.
    const outline = document.createElementNS(SVG_NS, "rect");
    outline.setAttribute("x", String(minX));
    outline.setAttribute("y", String(minY));
    outline.setAttribute("width", String(maxX - minX));
    outline.setAttribute("height", String(maxY - minY));
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", "#00d4ff");
    outline.setAttribute("stroke-width", String(sw));
    outline.setAttribute("stroke-dasharray", `${sw * 4}`);
    outline.style.pointerEvents = "none";
    this.#canvas.uiOverlay.appendChild(outline);
    this.#handles.push(outline as any);

    this.#drawBBoxHandles(new DOMRect(minX, minY, maxX - minX, maxY - minY));
  }

  // Handle indices: 0=TL, 1=TC, 2=TR, 3=MR, 4=BR, 5=BC, 6=BL, 7=ML
  static HANDLE_CURSORS = [
    "nwse-resize",
    "ns-resize",
    "nesw-resize",
    "ew-resize",
    "nwse-resize",
    "ns-resize",
    "nesw-resize",
    "ew-resize",
  ];

  #drawBBoxHandles(bbox: DOMRect): void {
    const points: [number, number][] = [
      [bbox.x, bbox.y], // 0: top-left
      [bbox.x + bbox.width / 2, bbox.y], // 1: top-center
      [bbox.x + bbox.width, bbox.y], // 2: top-right
      [bbox.x + bbox.width, bbox.y + bbox.height / 2], // 3: middle-right
      [bbox.x + bbox.width, bbox.y + bbox.height], // 4: bottom-right
      [bbox.x + bbox.width / 2, bbox.y + bbox.height], // 5: bottom-center
      [bbox.x, bbox.y + bbox.height], // 6: bottom-left
      [bbox.x, bbox.y + bbox.height / 2], // 7: middle-left
    ];

    const hs = HANDLE_SIZE / this.#canvas.zoom;
    for (let i = 0; i < points.length; i++) {
      const [cx, cy] = points[i]!;
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(cx - hs / 2));
      rect.setAttribute("y", String(cy - hs / 2));
      rect.setAttribute("width", String(hs));
      rect.setAttribute("height", String(hs));
      rect.setAttribute("fill", "#00d4ff");
      rect.setAttribute("stroke", "#fff");
      rect.setAttribute("stroke-width", String(1 / this.#canvas.zoom));
      // Loop bound matches `HANDLE_CURSORS.length` (both are the
      // 8-entry cardinal list); `[i]` is always defined.
      rect.style.cursor = SelectionManager.HANDLE_CURSORS[i]!;
      rect.style.pointerEvents = "all";
      this.#canvas.uiOverlay.appendChild(rect);
      this.#resizeHandles.push(rect);
    }
  }

  #setupEvents(): void {
    const svg = this.#canvas.svg;
    // All listeners opt-in to the shared AbortSignal so destroy() can
    // remove them en masse.
    const opts = { signal: this.#abort.signal };

    svg.addEventListener(
      "pointerdown",
      (e) => {
        if (this.#canvas.activeTool) return;
        if (e.button !== 0) return;
        // Skip pointerdowns that land inside a text-edit foreignObject
        // overlay. The overlay lives in `canvas.uiOverlay` (not under
        // the wrapper), so the bbox hit test below would otherwise
        // pick the underlying wrapper and start dragging it — leaving
        // the contentEditable orphaned at its original position. The
        // text-tool's own outside-pointerdown handler ignores clicks
        // inside the foreignObject (they're caret/selection clicks for
        // the editor), so we mirror that decision here for drags.
        if ((e.target as Element | null)?.closest?.("foreignObject")) return;

        const pt = this.#canvas.svgPoint(e);

        // Curve control-point handle (arrow groups). Tested before
        // other handles because it sits close to the line body and we
        // want the user to grab it unambiguously when they click it.
        if (this.#curveHandle && this.#selectedSet.size === 1) {
          const cx = Number.parseFloat(this.#curveHandle.getAttribute("cx")!);
          const cy = Number.parseFloat(this.#curveHandle.getAttribute("cy")!);
          const r = Number.parseFloat(this.#curveHandle.getAttribute("r")!);
          const dx = pt.x - cx;
          const dy = pt.y - cy;
          const hit = r * 2;
          if (dx * dx + dy * dy <= hit * hit) {
            const g = Array.from(this.#selectedSet)[0]!;
            // Normalize any legacy transform into endpoints first so
            // the CP is written in the same frame the user sees.
            bakeLineTransform(g);
            this.#draggingCurve = true;
            this.#gestureChangedContent = false;
            e.stopPropagation();
            return;
          }
        }

        // Rotation handle has the highest hit-test priority — it sits
        // outside the bbox so collisions with other handles are
        // unlikely, but we want unambiguous behavior when zoomed out.
        if (this.#rotationHandle && this.#selectedSet.size === 1) {
          const cx = Number.parseFloat(this.#rotationHandle.getAttribute("cx")!);
          const cy = Number.parseFloat(this.#rotationHandle.getAttribute("cy")!);
          const r = Number.parseFloat(this.#rotationHandle.getAttribute("r")!);
          const dx = pt.x - cx;
          const dy = pt.y - cy;
          const hit = r * 1.6;
          if (dx * dx + dy * dy <= hit * hit) {
            const g = Array.from(this.#selectedSet)[0]!;
            // Lines/arrows: bake any stale transform into endpoints
            // BEFORE snapshotting. After baking, the element's local
            // and world frames are identical, so the rotation gesture
            // operates entirely in svg-root coords. Then snapshot the
            // (post-bake) endpoints so each pointermove computes fresh
            // endpoints from a stable baseline (no accumulated drift).
            if (isLineLike(g)) {
              bakeLineTransform(g);
              const ep = lineEndpointsOf(g);
              this.#rotateLineSnapshot = { ...ep };
              this.#rotating = true;
              this.#gestureChangedContent = false;
              // Pivot = midpoint of endpoints (same convention as
              // bakeLineTransform). This keeps the rotation visually
              // centered on the line.
              this.#rotateCx = (ep.x1 + ep.x2) / 2;
              this.#rotateCy = (ep.y1 + ep.y2) / 2;
              this.#rotateStartRot = 0; // unused on the line path
              this.#rotateStartAngle =
                (Math.atan2(pt.y - this.#rotateCy, pt.x - this.#rotateCx) * 180) / Math.PI;
              e.stopPropagation();
              return;
            }
            // Pivot for rotation = element's bbox center in svg coords.
            const bb = getWorldBBox(g, this.#canvas.svg);
            if (bb) {
              this.#rotating = true;
              this.#gestureChangedContent = false;
              this.#rotateLineSnapshot = null;
              this.#rotateCx = bb.x + bb.width / 2;
              this.#rotateCy = bb.y + bb.height / 2;
              this.#rotateStartRot = readTransformState(g).rotation;
              this.#rotateStartAngle =
                (Math.atan2(pt.y - this.#rotateCy, pt.x - this.#rotateCx) * 180) / Math.PI;
              e.stopPropagation();
              return;
            }
          }
        }

        // Check if clicking the callout tail-tip handle FIRST. Tested
        // before the resize handles because, when the tip happens to sit
        // close to a corner handle, we want tail-drag to win — the user
        // explicitly placed it there.
        if (this.#tailHandle && this.#selectedSet.size === 1) {
          const cx = Number.parseFloat(this.#tailHandle.getAttribute("cx")!);
          const cy = Number.parseFloat(this.#tailHandle.getAttribute("cy")!);
          const r = Number.parseFloat(this.#tailHandle.getAttribute("r")!);
          const dx = pt.x - cx;
          const dy = pt.y - cy;
          // Hit zone slightly larger than the visual radius to make small
          // handles still grabbable on touch / coarse pointers.
          const hit = r * 1.6;
          if (dx * dx + dy * dy <= hit * hit) {
            this.#draggingTail = true;
            this.#gestureChangedContent = false;
            e.stopPropagation();
            return;
          }
        }

        // Check if clicking a resize handle (only for single selection).
        // Hit-test is over `#resizeHandles` (squares + line endpoints
        // only) so the index returned is exactly what `#resizeElement`
        // expects — decorations like the rotated outline polygon live in
        // `#handles` and don't get in the way.
        if (this.#selectedSet.size === 1) {
          for (let i = 0; i < this.#resizeHandles.length; i++) {
            const h = this.#resizeHandles[i];
            const hb = (h as SVGGraphicsElement).getBBox();
            if (
              pt.x >= hb.x &&
              pt.x <= hb.x + hb.width &&
              pt.y >= hb.y &&
              pt.y <= hb.y + hb.height
            ) {
              this.#resizing = true;
              this.#gestureChangedContent = false;
              this.#resizeHandle = i;
              this.#startX = pt.x;
              this.#startY = pt.y;
              // Reached only when `size === 1` was confirmed earlier.
              const sel = Array.from(this.#selectedSet)[0]!;
              // Snapshot the LOCAL bbox at gesture start. The resize
              // logic operates in local space (so a rotated rect stays
              // rotated while it's being resized), and the snapshot is
              // its only durable reference for "where we started".
              const sg = sel as SVGGraphicsElement;
              try {
                this.#origBBox = sg.getBBox();
              } catch {
                this.#origBBox = getWorldBBox(sel, this.#canvas.svg);
              }
              e.stopPropagation();
              return;
            }
          }
        }

        // Check if clicking an annotation element
        // First try DOM hit test
        const target = e.target as SVGElement;
        let annotation = target.closest("#annotations > *") as SVGElement | null;

        // If DOM miss, try BBox hit test (catches pointer-events:none children, thin lines, etc.)
        if (!annotation) {
          annotation = this.#hitTestBBox(pt);
        }

        if (annotation) {
          if (e.shiftKey) {
            this.toggleSelect(annotation);
          } else if (!this.#selectedSet.has(annotation)) {
            this.select(annotation);
          }
          this.#dragging = true;
          this.#gestureChangedContent = false;
          this.#startX = pt.x;
          this.#startY = pt.y;
          // Cache snap candidates (unselected element bboxes) once
          // per gesture — they don't move while the user drags.
          this.#snapCandidates = this.#collectSnapCandidates();
          e.stopPropagation();
          return;
        }

        // Click on empty area: start marquee or deselect
        if (!e.shiftKey) {
          this.select(null);
        }
        this.#isMarquee = true;
        this.#marqueeStartX = pt.x;
        this.#marqueeStartY = pt.y;

        this.#marquee = document.createElementNS(SVG_NS, "rect");
        this.#marquee.setAttribute("x", String(pt.x));
        this.#marquee.setAttribute("y", String(pt.y));
        this.#marquee.setAttribute("width", "0");
        this.#marquee.setAttribute("height", "0");
        this.#marquee.setAttribute("fill", "rgba(0,212,255,0.08)");
        this.#marquee.setAttribute("stroke", "#00d4ff");
        this.#marquee.setAttribute("stroke-width", String(1 / this.#canvas.zoom));
        this.#marquee.setAttribute("stroke-dasharray", `${3 / this.#canvas.zoom}`);
        this.#marquee.style.pointerEvents = "none";
        this.#canvas.uiOverlay.appendChild(this.#marquee);
      },
      opts,
    );

    svg.addEventListener(
      "pointermove",
      (e) => {
        if (this.#canvas.activeTool) return;
        const pt = this.#canvas.svgPoint(e);

        // Marquee drag
        if (this.#isMarquee && this.#marquee) {
          const x = Math.min(this.#marqueeStartX, pt.x);
          const y = Math.min(this.#marqueeStartY, pt.y);
          const w = Math.abs(pt.x - this.#marqueeStartX);
          const h = Math.abs(pt.y - this.#marqueeStartY);
          this.#marquee.setAttribute("x", String(x));
          this.#marquee.setAttribute("y", String(y));
          this.#marquee.setAttribute("width", String(w));
          this.#marquee.setAttribute("height", String(h));
          return;
        }

        // Drag selected elements
        if (this.#dragging && this.#selectedSet.size > 0) {
          let dx = pt.x - this.#startX;
          let dy = pt.y - this.#startY;
          if (dx !== 0 || dy !== 0) {
            // Smart-guide snap — adjust dx/dy so the selected bboxes'
            // edges/centers coincide with nearby unselected elements,
            // and draw dashed guide lines through the snapped axes.
            // Holding Alt disables snap so users can place elements
            // precisely without fighting the gravity wells.
            if (this.#snapCandidates && this.#snapCandidates.length > 0 && !e.altKey) {
              const draggedBoxes: DOMRect[] = [];
              for (const el of this.#selectedSet) {
                const gb = this.#worldBBox(el as SVGGraphicsElement);
                if (gb) draggedBoxes.push(gb);
              }
              if (draggedBoxes.length > 0) {
                const snap = computeSnap({
                  draggedBoxes,
                  dx,
                  dy,
                  otherBoxes: this.#snapCandidates,
                  threshold: 5,
                });
                dx = snap.dx;
                dy = snap.dy;
                if (!this.#smartGuides) {
                  this.#smartGuides = new SmartGuideOverlay(this.#canvas);
                }
                this.#smartGuides.render(snap.guides);
              }
            }

            // Only mark the gesture as "actually modified content" when the
            // pointer has moved. A plain click sets #dragging but never gets
            // here, so pointerup won't push a new history state.
            this.#gestureChangedContent = true;
            for (const el of this.#selectedSet) {
              this.#moveElement(el, dx, dy);
            }
            this.#startX = pt.x - (pt.x - this.#startX - dx); // advance by the snapped delta
            this.#startY = pt.y - (pt.y - this.#startY - dy);
            this.clearHandles();
            this.#drawAllHandles();
          }
        }

        // Tail-tip drag for callouts. Coords are stored in the textbox's
        // LOCAL pre-transform space — invert the element's CTM-relative-
        // to-svg to convert the pointer back into that frame (handles
        // rotation/flip uniformly).
        if (this.#draggingTail && this.#selectedSet.size === 1) {
          const g = Array.from(this.#selectedSet)[0]!;
          const local = pointToLocal(g, pt, this.#canvas.svg);
          this.#gestureChangedContent = true;
          setCalloutTail(g, local.x, local.y);
          this.clearHandles();
          this.#drawAllHandles();
        }

        // Curve control-point drag. The pointer position in svg-root
        // space IS the new control point (arrows are baked, so local
        // == world). Shift=snap CP to the perpendicular from line
        // midpoint so symmetric curves are easy to draw.
        if (this.#draggingCurve && this.#selectedSet.size === 1) {
          const g = Array.from(this.#selectedSet)[0]!;
          if (isArrowGroup(g)) {
            let cpx = pt.x;
            let cpy = pt.y;
            if (e.shiftKey) {
              // Snap to the line's perpendicular through midpoint —
              // gives a symmetric U-curve.
              const ep = readArrowEndpoints(g);
              const mx = (ep.x1 + ep.x2) / 2;
              const my = (ep.y1 + ep.y2) / 2;
              const ldx = ep.x2 - ep.x1;
              const ldy = ep.y2 - ep.y1;
              const L2 = ldx * ldx + ldy * ldy;
              if (L2 > 1e-6) {
                // Project (pt - mid) onto line direction, subtract from
                // the vector to get the perpendicular component, add to
                // midpoint.
                const t = ((pt.x - mx) * ldx + (pt.y - my) * ldy) / L2;
                const projX = mx + t * ldx;
                const projY = my + t * ldy;
                const perpX = pt.x - projX;
                const perpY = pt.y - projY;
                cpx = mx + perpX;
                cpy = my + perpY;
              }
            }
            writeArrowControl(g, { x: cpx, y: cpy });
            refreshArrowPath(g);
            this.#gestureChangedContent = true;
            this.clearHandles();
            this.#drawAllHandles();
          }
          return;
        }

        // Rotation handle drag — angle delta from gesture start.
        if (this.#rotating && this.#selectedSet.size === 1) {
          const g = Array.from(this.#selectedSet)[0]!;
          const ang = (Math.atan2(pt.y - this.#rotateCy, pt.x - this.#rotateCx) * 180) / Math.PI;
          let deltaDeg = ang - this.#rotateStartAngle;
          // Shift = snap to 15° increments (Figma / PowerPoint convention).
          // For lines we snap the DELTA; for non-lines we snap the
          // absolute rotation (same end result either way).
          this.#gestureChangedContent = true;
          if (this.#rotateLineSnapshot) {
            // Line/arrow path: rotate the snapshot endpoints around the
            // pivot. No transform attribute involved — the new endpoint
            // positions ARE the rotation result.
            if (e.shiftKey) deltaDeg = Math.round(deltaDeg / 15) * 15;
            const rad = (deltaDeg * Math.PI) / 180;
            const snap = this.#rotateLineSnapshot;
            const p1 = rotateAround(snap.x1, snap.y1, this.#rotateCx, this.#rotateCy, rad);
            const p2 = rotateAround(snap.x2, snap.y2, this.#rotateCx, this.#rotateCy, rad);
            setLineEndpoints(g, p1.x, p1.y, p2.x, p2.y);
          } else {
            let next = this.#rotateStartRot + deltaDeg;
            if (e.shiftKey) next = Math.round(next / 15) * 15;
            setRotation(g, next);
          }
          this.clearHandles();
          this.#drawAllHandles();
        }

        // Resize (single selection only). Convert the pointer into the
        // element's LOCAL pre-transform frame so the same axis-aligned
        // resize logic Just Works for rotated/flipped shapes — the
        // pointer is "what the user grabbed" expressed in the same
        // coordinate space as x/y/width/height.
        if (this.#resizing && this.#selectedSet.size === 1 && this.#origBBox) {
          const el = Array.from(this.#selectedSet)[0]!;
          // Always convert the pointer into the element's local
          // pre-transform frame. Lines need this too once a rotation
          // transform is on the element — without it, dragging an
          // endpoint to the visual cursor position writes svg-root
          // coords into x1/y1 (which are local), so the rendered line
          // jumps away from the cursor.
          const localPt = pointToLocal(el, pt, this.#canvas.svg);
          this.#gestureChangedContent = true;
          this.#resizeElement(el, this.#resizeHandle, localPt, this.#origBBox);
          this.clearHandles();
          this.#drawAllHandles();
        }
      },
      opts,
    );

    svg.addEventListener(
      "pointerup",
      (e) => {
        // Finish marquee selection
        if (this.#isMarquee && this.#marquee) {
          const mx = Number.parseFloat(this.#marquee.getAttribute("x")!);
          const my = Number.parseFloat(this.#marquee.getAttribute("y")!);
          const mw = Number.parseFloat(this.#marquee.getAttribute("width")!);
          const mh = Number.parseFloat(this.#marquee.getAttribute("height")!);
          this.#marquee.remove();
          this.#marquee = null;
          this.#isMarquee = false;

          if (mw > 3 && mh > 3) {
            // Find all annotations intersecting the marquee
            const hits = this.#findInRect(mx, my, mw, mh);
            if (hits.length > 0) {
              if (e.shiftKey) {
                // Add to existing selection
                for (const h of hits) this.#selectedSet.add(h);
                this.clearHandles();
                this.#drawAllHandles();
                this.onChange?.();
              } else {
                this.selectMultiple(hits);
              }
            }
          }
          return;
        }

        // Push a history state only when the gesture actually modified
        // content. A plain click (select → release without moving) sets
        // #dragging but leaves #gestureChangedContent false, so we skip
        // the save — no spurious "Edited" in the autosave indicator.
        if (
          (this.#dragging ||
            this.#resizing ||
            this.#draggingTail ||
            this.#rotating ||
            this.#draggingCurve) &&
          this.#gestureChangedContent
        ) {
          this.#history.save();
        }
        this.#dragging = false;
        this.#resizing = false;
        this.#draggingTail = false;
        this.#rotating = false;
        this.#draggingCurve = false;
        this.#rotateLineSnapshot = null;
        this.#gestureChangedContent = false;
        this.#origBBox = null;
        // Clear smart-guide overlay — guides are only meaningful mid-drag.
        this.#smartGuides?.clear();
        this.#snapCandidates = null;
      },
      opts,
    );

    document.addEventListener(
      "keydown",
      (e) => {
        if (this.#canvas.activeTool) return;
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
        // Also skip if inside a foreignObject (text editing)
        if (t.closest?.("foreignObject")) return;

        if ((e.key === "Delete" || e.key === "Backspace") && this.#selectedSet.size > 0) {
          e.preventDefault();
          this.deleteSelected();
          return;
        }
        // Ctrl+A: select all
        if (e.ctrlKey && e.key === "a") {
          e.preventDefault();
          const all = Array.from(this.#canvas.annotations.children) as SVGElement[];
          this.selectMultiple(all);
          return;
        }
        // Ctrl+C: copy selected
        if (e.ctrlKey && e.key === "c" && this.#selectedSet.size > 0) {
          e.preventDefault();
          this.copySelected();
          return;
        }
        // Ctrl+V: paste
        if (e.ctrlKey && e.key === "v") {
          if (this.#clipboard.length > 0) {
            e.preventDefault();
            this.paste();
            return;
          }
          // If no internal clipboard, let browser handle (image paste etc.)
        }
        // Ctrl+D: duplicate
        if (e.ctrlKey && e.key === "d" && this.#selectedSet.size > 0) {
          e.preventDefault();
          this.duplicate();
          return;
        }
        // Shift+H / Shift+V: flip horizontally / vertically. Operates on
        // every selected element so multi-select flips as a batch.
        if (e.shiftKey && (e.key === "H" || e.key === "h") && this.#selectedSet.size > 0) {
          e.preventDefault();
          // toggleFlip auto-dispatches for line/arrow (bake-flip) vs
          // other elements (data-flip attribute).
          for (const el of this.#selectedSet) toggleFlip(el, "h");
          this.clearHandles();
          this.#drawAllHandles();
          this.#history.save();
          return;
        }
        if (e.shiftKey && (e.key === "V" || e.key === "v") && this.#selectedSet.size > 0) {
          e.preventDefault();
          for (const el of this.#selectedSet) toggleFlip(el, "v");
          this.clearHandles();
          this.#drawAllHandles();
          this.#history.save();
          return;
        }

        // Group: Ctrl+G group, Ctrl+Shift+G ungroup — Illustrator /
        // PowerPoint / Figma convention.
        if (e.ctrlKey && (e.key === "g" || e.key === "G")) {
          e.preventDefault();
          if (e.shiftKey) this.ungroupSelected();
          else this.groupSelected();
          return;
        }

        // Z-order: Ctrl+] bring forward, Ctrl+[ send backward, add Shift
        // for "all the way" (PowerPoint / Illustrator / Affinity convention).
        // Matches on the physical bracket keys regardless of kbd layout
        // by checking both `]`/`[` and their Shift-pressed `}`/`{`.
        if (e.ctrlKey && this.#selectedSet.size > 0) {
          const isCloseBracket = e.key === "]" || e.key === "}";
          const isOpenBracket = e.key === "[" || e.key === "{";
          if (isCloseBracket) {
            e.preventDefault();
            if (e.shiftKey) this.bringToFront();
            else this.bringForward();
            return;
          }
          if (isOpenBracket) {
            e.preventDefault();
            if (e.shiftKey) this.sendToBack();
            else this.sendBackward();
            return;
          }
        }

        // Arrow keys: move selected elements
        if (
          this.#selectedSet.size > 0 &&
          ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
        ) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1; // Shift = 10px steps
          let dx = 0;
          let dy = 0;
          switch (e.key) {
            case "ArrowUp":
              dy = -step;
              break;
            case "ArrowDown":
              dy = step;
              break;
            case "ArrowLeft":
              dx = -step;
              break;
            case "ArrowRight":
              dx = step;
              break;
          }
          for (const el of this.#selectedSet) {
            this.#moveElement(el, dx, dy);
          }
          this.clearHandles();
          this.#drawAllHandles();
          this.#history.save();
        }
      },
      opts,
    );
  }

  /** Hit test by checking if point falls within any annotation's bounding box */
  #hitTestBBox(pt: DOMPoint): SVGElement | null {
    const children = this.#canvas.annotations.children;
    // Iterate in reverse (topmost elements first)
    for (let i = children.length - 1; i >= 0; i--) {
      const el = children[i] as SVGElement;
      const bbox = getWorldBBox(el, this.#canvas.svg);
      if (!bbox) continue;
      // Expand thin elements (lines) by a few pixels for easier clicking
      const pad = 6 / this.#canvas.zoom;
      if (
        pt.x >= bbox.x - pad &&
        pt.x <= bbox.x + bbox.width + pad &&
        pt.y >= bbox.y - pad &&
        pt.y <= bbox.y + bbox.height + pad
      ) {
        return el;
      }
    }
    return null;
  }

  /** Find annotation elements whose bounding box intersects the given rect */
  #findInRect(rx: number, ry: number, rw: number, rh: number): SVGElement[] {
    const result: SVGElement[] = [];
    const children = this.#canvas.annotations.children;
    for (let i = 0; i < children.length; i++) {
      const el = children[i] as SVGElement;
      const bbox = (el as SVGGraphicsElement).getBBox?.();
      if (!bbox) continue;
      // Check intersection
      if (
        bbox.x + bbox.width > rx &&
        bbox.y + bbox.height > ry &&
        bbox.x < rx + rw &&
        bbox.y < ry + rh
      ) {
        result.push(el);
      }
    }
    return result;
  }

  #moveElement(el: SVGElement, dx: number, dy: number): void {
    const tag = el.tagName;
    if (tag === "rect" || tag === "image") {
      el.setAttribute("x", String(Number.parseFloat(el.getAttribute("x") || "0") + dx));
      el.setAttribute("y", String(Number.parseFloat(el.getAttribute("y") || "0") + dy));
    } else if (tag === "ellipse") {
      el.setAttribute("cx", String(Number.parseFloat(el.getAttribute("cx") || "0") + dx));
      el.setAttribute("cy", String(Number.parseFloat(el.getAttribute("cy") || "0") + dy));
    } else if (isLineLike(el)) {
      // Line / arrow: rotation is baked into endpoints, so no
      // transform attribute exists and local space == world space.
      // Just shift the endpoints by the world-space drag delta.
      // (bakeLineTransform normalizes any legacy saved content that
      //  still carries a transform — see the pointerdown hook below.)
      bakeLineTransform(el);
      const ep = lineEndpointsOf(el);
      setLineEndpoints(el, ep.x1 + dx, ep.y1 + dy, ep.x2 + dx, ep.y2 + dy);
      // Curved arrow: translate the control point alongside the
      // endpoints so the curve shape travels with the line.
      if (isArrowGroup(el)) {
        const control = readArrowControl(el);
        if (control) {
          writeArrowControl(el, { x: control.x + dx, y: control.y + dy });
          refreshArrowPath(el);
        }
      }
      return;
    } else if (tag === "text" || tag === "foreignObject") {
      el.setAttribute("x", String(Number.parseFloat(el.getAttribute("x") || "0") + dx));
      el.setAttribute("y", String(Number.parseFloat(el.getAttribute("y") || "0") + dy));
    } else if (tag === "path" || tag === "g") {
      // Translate-positioned: nudge data-tx/data-ty and let
      // applyTransformState rebuild the composite transform.
      nudgeTranslate(el, dx, dy);
      return;
    }
    // Geometry-positioned: re-apply transform so the rotation/flip
    // pivot tracks the new bbox center (otherwise rotated elements
    // would drift toward their former pivot).
    nudgeTranslate(el, 0, 0);
  }

  #resizeElement(el: SVGElement, handleIdx: number, pt: DOMPoint, orig: DOMRect): void {
    const tag = el.tagName;

    // Line/arrow: drag endpoints. Works for both `<line>` and
    // `<g data-type="arrow">` via the setLineEndpoints helper.
    const isArrowPath = isArrowGroup(el);
    if (tag === "line" || isArrowPath) {
      const ep = lineEndpointsOf(el);
      if (handleIdx === 0) {
        setLineEndpoints(el, pt.x, pt.y, ep.x2, ep.y2);
      } else {
        setLineEndpoints(el, ep.x1, ep.y1, pt.x, pt.y);
      }
      return;
    }

    // Text-bearing shape group: resize box with directional constraints
    // (same as rect)
    if (tag === "g" && el.getAttribute("data-type") === "shape") {
      const bgRect = el.querySelector("rect");
      if (!bgRect) return;

      const h = handleIdx;
      const changeX = h !== 1 && h !== 5;
      const changeY = h !== 3 && h !== 7;
      const fromLeft = h === 0 || h === 6 || h === 7;
      const fromTop = h === 0 || h === 1 || h === 2;

      let x = Number.parseFloat(bgRect.getAttribute("x") || String(orig.x));
      let y = Number.parseFloat(bgRect.getAttribute("y") || String(orig.y));
      let w = Number.parseFloat(bgRect.getAttribute("width") || String(orig.width));
      let bh = Number.parseFloat(bgRect.getAttribute("height") || String(orig.height));

      if (changeX) {
        if (fromLeft) {
          const right = x + w;
          x = Math.min(pt.x, right - 60);
          w = right - x;
        } else {
          w = Math.max(60, pt.x - x);
        }
      }
      if (changeY) {
        if (fromTop) {
          const bottom = y + bh;
          y = Math.min(pt.y, bottom - 30);
          bh = bottom - y;
        } else {
          bh = Math.max(30, pt.y - y);
        }
      }

      bgRect.setAttribute("x", String(x));
      bgRect.setAttribute("y", String(y));
      bgRect.setAttribute("width", String(w));
      bgRect.setAttribute("height", String(bh));

      // Update clip rect if present
      const clipRect = el.querySelector("clipPath rect");
      if (clipRect) {
        clipRect.setAttribute("x", String(x));
        clipRect.setAttribute("y", String(y));
        clipRect.setAttribute("width", String(w));
        clipRect.setAttribute("height", String(bh));
      }

      // Keep the callout tail's base attached to the resized box.
      // Without this, the bg rect moves but the triangle still anchors
      // at the OLD edge midpoint, leaving a visible gap.
      rebuildCalloutTail(el);

      // Re-flow the inner <text> tspans against the new box bounds.
      // Without this, every per-tspan x/y stays pinned to the original
      // layout: a left-anchored run resized leftward stops hugging the
      // new left edge; a centered run drifts off-center; the run block
      // can clip outside the new clipPath. `replaceRunsInPlace` reads
      // the current bg `<rect>` bounds + wrapper data-* attrs (font,
      // anchors, margins) and re-emits the tspan layout — same path
      // text edits / variant conversions / margin adjustments take.
      const hasInnerText = el.querySelector("text") != null;
      if (hasInnerText) {
        const runs = readTextShapeSpec(el).runs;
        replaceRunsInPlace(el, runs);
      }

      // Re-apply the composite transform so rotation/flip pivot
      // tracks the new bbox center.
      applyTransformState(el);

      return;
    }

    // Handle indices: 0=TL, 1=TC, 2=TR, 3=MR, 4=BR, 5=BC, 6=BL, 7=ML
    // For group handles with outline, offset index by 1 (outline is handles[0])
    const h = handleIdx;
    const changeX = h !== 1 && h !== 5; // top-center and bottom-center: no X change
    const changeY = h !== 3 && h !== 7; // middle-right and middle-left: no Y change
    const fromLeft = h === 0 || h === 6 || h === 7; // TL, BL, ML
    const fromTop = h === 0 || h === 1 || h === 2; // TL, TC, TR

    if (tag === "rect" || tag === "image" || tag === "foreignObject") {
      let x = Number.parseFloat(el.getAttribute("x") || String(orig.x));
      let y = Number.parseFloat(el.getAttribute("y") || String(orig.y));
      let w = Number.parseFloat(el.getAttribute("width") || String(orig.width));
      let h2 = Number.parseFloat(el.getAttribute("height") || String(orig.height));

      if (changeX) {
        if (fromLeft) {
          const right = x + w;
          x = Math.min(pt.x, right - 10);
          w = right - x;
        } else {
          w = Math.max(10, pt.x - x);
        }
      }
      if (changeY) {
        if (fromTop) {
          const bottom = y + h2;
          y = Math.min(pt.y, bottom - 10);
          h2 = bottom - y;
        } else {
          h2 = Math.max(10, pt.y - y);
        }
      }
      el.setAttribute("x", String(x));
      el.setAttribute("y", String(y));
      el.setAttribute("width", String(w));
      el.setAttribute("height", String(h2));
    } else if (tag === "ellipse") {
      let cx = Number.parseFloat(el.getAttribute("cx") || "0");
      let cy = Number.parseFloat(el.getAttribute("cy") || "0");
      let rx = Number.parseFloat(el.getAttribute("rx") || "0");
      let ry = Number.parseFloat(el.getAttribute("ry") || "0");

      if (changeX) {
        if (fromLeft) {
          const right = cx + rx;
          const newLeft = Math.min(pt.x, right - 5);
          rx = (right - newLeft) / 2;
          cx = newLeft + rx;
        } else {
          rx = Math.max(5, Math.abs(pt.x - (cx - rx)) / 2);
          cx = cx - rx + rx; // keep left edge, recalc center
          const left = cx - rx;
          rx = Math.max(5, (pt.x - left) / 2);
          cx = left + rx;
        }
      }
      if (changeY) {
        if (fromTop) {
          const bottom = cy + ry;
          const newTop = Math.min(pt.y, bottom - 5);
          ry = (bottom - newTop) / 2;
          cy = newTop + ry;
        } else {
          const top = cy - ry;
          ry = Math.max(5, (pt.y - top) / 2);
          cy = top + ry;
        }
      }
      el.setAttribute("cx", String(cx));
      el.setAttribute("cy", String(cy));
      el.setAttribute("rx", String(rx));
      el.setAttribute("ry", String(ry));
    }
    // Re-apply composite transform so a rotated element keeps its
    // rotation pivoted on the new bbox center after resize.
    applyTransformState(el);
  }
}
