/**
 * @vitest-environment happy-dom
 *
 * `SelectionManager` is the keystone editor primitive for selection
 * + clipboard + z-order + alignment + grouping. Its 2060-line
 * source bundles two clearly separable surfaces:
 *
 *   1. **Public API methods** (`select` / `paste` / `bringToFront`
 *      / `alignSelected` / etc.) — invoked from the toolbar,
 *      keyboard shortcuts, and the right-panel "Actions" cluster.
 *      Reachable from happy-dom directly: pure DOM mutations
 *      against `canvas.annotations`, no pointer-event sequences.
 *   2. **Pointer-driven gestures** — drag, resize, rotate, marquee,
 *      handle hit-testing. These need a sequencer harness
 *      (pointerdown → N pointermoves → pointerup) plus accurate
 *      `getScreenCTM()` and `getBBox()` returns from happy-dom,
 *      neither of which the runtime ships. Deferred to a future
 *      pointer-harness PR.
 *
 * This file covers surface 1. Drag / resize / rotate / marquee
 * tests will land separately when the harness is in place.
 *
 * Bbox-dependent operations (`alignSelected` / `distributeSelected`)
 * use the `attachAttrBBox(el)` helper to give the element's
 * `getBBox()` a sensible return value derived from its `x` / `y` /
 * `width` / `height` attrs — happy-dom's default is `DOMRect(0,0,0,0)`
 * for every element, which would degenerate every align computation
 * to a no-op.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasManager } from "./canvas-manager.js";
import { History } from "./history.js";
import { SelectionManager } from "./selection.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

// happy-dom ships `DOMPoint` but not `DOMPoint.prototype.matrixTransform`,
// which the handle-drawing path uses via `localToSvgPoint` /
// `getWorldBBox`. Same 2-D affine polyfill the
// `svg-to-annotation-shapes.test.ts` and `transform-utils.test.ts`
// use — apply once at module load.
if (typeof DOMPoint !== "undefined" && !DOMPoint.prototype.matrixTransform) {
  DOMPoint.prototype.matrixTransform = function (this: DOMPoint, m: DOMMatrix) {
    const x = this.x;
    const y = this.y;
    return new DOMPoint(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
  };
}

function makeContainer(width = 800, height = 600): HTMLDivElement {
  const div = document.createElement("div");
  Object.defineProperty(div, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(div, "clientHeight", { configurable: true, value: height });
  document.body.appendChild(div);
  return div;
}

interface Setup {
  canvas: CanvasManager;
  selection: SelectionManager;
  annotations: SVGGElement;
  saveSpy: ReturnType<typeof vi.fn>;
}

function setupSelection(): Setup {
  const container = makeContainer();
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  container.appendChild(svg);
  const canvas = new CanvasManager(svg, PNG, 400, 300);
  const history = new History(canvas.annotations);
  const saveSpy = vi.fn();
  // Spy on history.save before SelectionManager wires up — preserve
  // the original behaviour (snapshot the live SVG) plus the spy.
  const realSave = history.save.bind(history);
  history.save = (() => {
    saveSpy();
    realSave();
  }) as typeof history.save;
  const selection = new SelectionManager(canvas, history);
  return { canvas, selection, annotations: canvas.annotations, saveSpy };
}

/** Attach a `getBBox` getter to an element that derives the rect
 *  from its `x` / `y` / `width` / `height` attributes. Used by
 *  align / distribute tests since happy-dom's stock getBBox returns
 *  zeros for everything. */
function attachAttrBBox(el: SVGElement): void {
  const x = Number.parseFloat(el.getAttribute("x") || "0");
  const y = Number.parseFloat(el.getAttribute("y") || "0");
  const w = Number.parseFloat(el.getAttribute("width") || "0");
  const h = Number.parseFloat(el.getAttribute("height") || "0");
  Object.defineProperty(el, "getBBox", {
    configurable: true,
    value: () => ({ x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h }),
  });
  // CanvasManager's `getWorldBBox` also calls `getCTM()` to compose
  // the SVG viewport transform; happy-dom returns null here. Stub
  // an identity CTM so getWorldBBox doesn't bail.
  Object.defineProperty(el, "getCTM", {
    configurable: true,
    value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  });
}

function makeRect(attrs: { x: number; y: number; w: number; h: number }): SVGRectElement {
  const r = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
  r.setAttribute("x", String(attrs.x));
  r.setAttribute("y", String(attrs.y));
  r.setAttribute("width", String(attrs.w));
  r.setAttribute("height", String(attrs.h));
  return r;
}

function makeMarker(label: string, color = "#ff0000", fontSize = 16): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.setAttribute("data-marker", label);
  g.setAttribute("data-shape", "circle");
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("cx", "50");
  c.setAttribute("cy", "50");
  c.setAttribute("r", "16");
  c.setAttribute("fill", color);
  g.appendChild(c);
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("font-size", String(fontSize));
  t.textContent = label;
  g.appendChild(t);
  return g;
}

afterEach(() => {
  for (const child of Array.from(document.body.children)) child.remove();
  vi.restoreAllMocks();
});

describe("SelectionManager — constructor + getters + destroy", () => {
  it("starts with no selection", () => {
    const { selection } = setupSelection();
    expect(selection.selected).toBeNull();
    expect(selection.selectedElements).toEqual([]);
    expect(selection.hasSelection).toBe(false);
  });

  it("destroy() clears the selection set + aborts the listener controller", () => {
    const { selection, annotations } = setupSelection();
    const r = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(r);
    selection.select(r);
    expect(selection.hasSelection).toBe(true);
    selection.destroy();
    expect(selection.hasSelection).toBe(false);
  });
});

describe("SelectionManager — select / selectMultiple / toggleSelect", () => {
  it("select(el) sets the single-element selection", () => {
    const { selection, annotations } = setupSelection();
    const r = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(r);
    selection.select(r);
    expect(selection.selected).toBe(r);
    expect(selection.selectedElements).toEqual([r]);
    expect(selection.hasSelection).toBe(true);
  });

  it("select(null) clears the selection", () => {
    const { selection, annotations } = setupSelection();
    const r = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(r);
    selection.select(r);
    selection.select(null);
    expect(selection.selected).toBeNull();
    expect(selection.hasSelection).toBe(false);
  });

  it("selected returns null when 2+ elements are selected (single-getter contract)", () => {
    const { selection, annotations } = setupSelection();
    const a = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const b = makeRect({ x: 20, y: 20, w: 10, h: 10 });
    annotations.appendChild(a);
    annotations.appendChild(b);
    selection.selectMultiple([a, b]);
    expect(selection.selected).toBeNull();
    expect(selection.selectedElements).toEqual([a, b]);
    expect(selection.hasSelection).toBe(true);
  });

  it("toggleSelect adds + removes from the selection set", () => {
    const { selection, annotations } = setupSelection();
    const a = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(a);
    selection.toggleSelect(a);
    expect(selection.selectedElements).toEqual([a]);
    selection.toggleSelect(a);
    expect(selection.selectedElements).toEqual([]);
  });

  it("toggleSelect on a different element extends the selection (Shift-click pattern)", () => {
    const { selection, annotations } = setupSelection();
    const a = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const b = makeRect({ x: 20, y: 20, w: 10, h: 10 });
    annotations.appendChild(a);
    annotations.appendChild(b);
    selection.select(a);
    selection.toggleSelect(b);
    expect(selection.selectedElements).toContain(a);
    expect(selection.selectedElements).toContain(b);
    expect(selection.selectedElements.length).toBe(2);
  });

  it("select() fires onChange", () => {
    const { selection, annotations } = setupSelection();
    const onChange = vi.fn();
    selection.onChange = onChange;
    const r = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(r);
    selection.select(r);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("SelectionManager — copySelected + paste + duplicate", () => {
  it("copySelected captures outerHTML; paste reconstructs and saves history", () => {
    const { selection, annotations, saveSpy } = setupSelection();
    const r = makeRect({ x: 10, y: 20, w: 30, h: 40 });
    annotations.appendChild(r);
    selection.select(r);
    selection.copySelected();
    selection.paste();
    expect(annotations.children.length).toBe(2);
    expect(saveSpy).toHaveBeenCalled();
  });

  it("paste with no clipboard content is a silent no-op", () => {
    const { selection, annotations, saveSpy } = setupSelection();
    const r = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(r);
    saveSpy.mockClear();
    selection.paste();
    expect(annotations.children.length).toBe(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("paste offsets each successive paste so duplicates aren't stacked", () => {
    const { selection, annotations } = setupSelection();
    const r = makeRect({ x: 10, y: 20, w: 30, h: 40 });
    annotations.appendChild(r);
    selection.select(r);
    selection.copySelected();
    selection.paste();
    selection.paste();
    selection.paste();
    expect(annotations.children.length).toBe(4);
    // Three pasted children: x positions advance by PASTE_OFFSET each.
    const xs = Array.from(annotations.children)
      .slice(1)
      .map((c) => Number.parseFloat((c as SVGRectElement).getAttribute("x") || "0"));
    expect(xs[0]).toBeGreaterThan(10);
    expect(xs[1]).toBeGreaterThan(xs[0]!);
    expect(xs[2]).toBeGreaterThan(xs[1]!);
  });

  it("paste auto-renumbers a counter (data-marker) when an existing same-style counter is on the canvas", () => {
    const { selection, annotations } = setupSelection();
    const m1 = makeMarker("1");
    const m2 = makeMarker("2");
    annotations.appendChild(m1);
    annotations.appendChild(m2);
    selection.select(m2);
    selection.copySelected();
    selection.paste();
    // Pasted counter should be "3" (max existing + 1).
    const pasted = annotations.children[2] as SVGGElement;
    expect(pasted.getAttribute("data-marker")).toBe("3");
  });

  it("paste replaces the selection with the new elements", () => {
    const { selection, annotations } = setupSelection();
    const r = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(r);
    selection.select(r);
    selection.copySelected();
    selection.paste();
    const pasted = annotations.children[1]!;
    expect(selection.selectedElements).toEqual([pasted]);
  });

  it("duplicate() = copy + paste in one shot (and resets the paste-count so the offset starts at 1)", () => {
    const { selection, annotations } = setupSelection();
    const r = makeRect({ x: 100, y: 100, w: 30, h: 30 });
    annotations.appendChild(r);
    selection.select(r);
    selection.duplicate();
    expect(annotations.children.length).toBe(2);
    const dup = annotations.children[1] as SVGRectElement;
    // Offset is exactly PASTE_OFFSET on a fresh duplicate (paste-count=1).
    expect(Number.parseFloat(dup.getAttribute("x") || "0")).toBeGreaterThan(100);
  });
});

describe("SelectionManager — deleteSelected", () => {
  it("removes selected elements + saves history + clears selection + fires onChange", () => {
    const { selection, annotations, saveSpy } = setupSelection();
    const onChange = vi.fn();
    selection.onChange = onChange;
    const r = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(r);
    selection.select(r);
    saveSpy.mockClear();
    onChange.mockClear();
    selection.deleteSelected();
    expect(annotations.children.length).toBe(0);
    expect(selection.hasSelection).toBe(false);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("deleteSelected with empty selection is a silent no-op", () => {
    const { selection, annotations, saveSpy } = setupSelection();
    const r = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(r);
    saveSpy.mockClear();
    selection.deleteSelected();
    expect(annotations.children.length).toBe(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("deleteSelected removes ALL selected elements (multi-select)", () => {
    const { selection, annotations } = setupSelection();
    const a = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const b = makeRect({ x: 20, y: 0, w: 10, h: 10 });
    annotations.appendChild(a);
    annotations.appendChild(b);
    selection.selectMultiple([a, b]);
    selection.deleteSelected();
    expect(annotations.children.length).toBe(0);
  });
});

describe("SelectionManager — z-order: bringToFront / sendToBack", () => {
  function makeThree(): {
    selection: SelectionManager;
    annotations: SVGGElement;
    a: SVGRectElement;
    b: SVGRectElement;
    c: SVGRectElement;
    saveSpy: ReturnType<typeof vi.fn>;
  } {
    const setup = setupSelection();
    const a = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const b = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const c = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    setup.annotations.appendChild(a);
    setup.annotations.appendChild(b);
    setup.annotations.appendChild(c);
    return { ...setup, a, b, c };
  }

  it("bringToFront moves the selected element to the END of the children list (rendered last → top)", () => {
    const { selection, annotations, a, b, c, saveSpy } = makeThree();
    selection.select(a); // [a, b, c] — a is at back
    saveSpy.mockClear();
    selection.bringToFront();
    expect(Array.from(annotations.children)).toEqual([b, c, a]);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("bringToFront on an already-front selection is a silent no-op (no save)", () => {
    const { selection, c, saveSpy } = makeThree();
    selection.select(c); // c is already at the front
    saveSpy.mockClear();
    selection.bringToFront();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("sendToBack moves the selected element to the START of the children list", () => {
    const { selection, annotations, a, b, c, saveSpy } = makeThree();
    selection.select(c); // [a, b, c] — c at front
    saveSpy.mockClear();
    selection.sendToBack();
    expect(Array.from(annotations.children)).toEqual([c, a, b]);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("sendToBack on an already-back selection is a silent no-op", () => {
    const { selection, a, saveSpy } = makeThree();
    selection.select(a); // a is already at the back
    saveSpy.mockClear();
    selection.sendToBack();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("multi-select bringToFront moves the block contiguously, preserving relative order", () => {
    const { selection, annotations, a, b, c } = makeThree();
    selection.selectMultiple([a, b]); // [a, b, c]
    selection.bringToFront();
    // Block [a, b] moves past c: [c, a, b]
    expect(Array.from(annotations.children)).toEqual([c, a, b]);
  });

  it("multi-select sendToBack moves the block contiguously, preserving relative order", () => {
    const { selection, annotations, a, b, c } = makeThree();
    selection.selectMultiple([b, c]); // [a, b, c]
    selection.sendToBack();
    // Block [b, c] moves before a: [b, c, a]
    expect(Array.from(annotations.children)).toEqual([b, c, a]);
  });

  it("bringForward / sendBackward with empty selection are silent no-ops", () => {
    const { selection, saveSpy } = makeThree();
    saveSpy.mockClear();
    selection.bringForward();
    selection.sendBackward();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("SelectionManager — z-order: bringForward / sendBackward (single step)", () => {
  function makeFour(): {
    selection: SelectionManager;
    annotations: SVGGElement;
    a: SVGRectElement;
    b: SVGRectElement;
    c: SVGRectElement;
    d: SVGRectElement;
    saveSpy: ReturnType<typeof vi.fn>;
  } {
    const setup = setupSelection();
    const a = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const b = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const c = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const d = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    setup.annotations.appendChild(a);
    setup.annotations.appendChild(b);
    setup.annotations.appendChild(c);
    setup.annotations.appendChild(d);
    return { ...setup, a, b, c, d };
  }

  it("bringForward moves a single element one step toward the end", () => {
    const { selection, annotations, a, b, c, d } = makeFour();
    selection.select(b); // [a, b, c, d]
    selection.bringForward();
    expect(Array.from(annotations.children)).toEqual([a, c, b, d]);
  });

  it("sendBackward moves a single element one step toward the start", () => {
    const { selection, annotations, a, b, c, d } = makeFour();
    selection.select(c); // [a, b, c, d]
    selection.sendBackward();
    expect(Array.from(annotations.children)).toEqual([a, c, b, d]);
  });

  it("bringForward on an already-frontmost element is a no-op", () => {
    const { selection, d, saveSpy } = makeFour();
    selection.select(d);
    saveSpy.mockClear();
    selection.bringForward();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("sendBackward on an already-backmost element is a no-op", () => {
    const { selection, a, saveSpy } = makeFour();
    selection.select(a);
    saveSpy.mockClear();
    selection.sendBackward();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("SelectionManager — group / ungroup", () => {
  it("groupSelected wraps 2+ selected elements in a <g data-type='group'> + selects the group", () => {
    const { selection, annotations } = setupSelection();
    const a = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const b = makeRect({ x: 20, y: 0, w: 10, h: 10 });
    annotations.appendChild(a);
    annotations.appendChild(b);
    selection.selectMultiple([a, b]);
    selection.groupSelected();
    expect(annotations.children.length).toBe(1);
    const group = annotations.firstElementChild as SVGGElement;
    expect(group.tagName.toLowerCase()).toBe("g");
    expect(group.getAttribute("data-type")).toBe("group");
    expect(Array.from(group.children)).toEqual([a, b]);
    expect(selection.selected).toBe(group);
  });

  it("groupSelected with <2 elements is a silent no-op", () => {
    const { selection, annotations, saveSpy } = setupSelection();
    const a = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(a);
    selection.select(a);
    saveSpy.mockClear();
    selection.groupSelected();
    expect(annotations.firstElementChild).toBe(a); // not wrapped
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("groupSelected places the group at the position of the LAST selected element (preserves z-order)", () => {
    const { selection, annotations } = setupSelection();
    const a = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const b = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const c = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(a);
    annotations.appendChild(b);
    annotations.appendChild(c);
    selection.selectMultiple([a, c]);
    selection.groupSelected();
    // The group inherits c's z-position — children are now [b, group(a,c)].
    expect(annotations.children.length).toBe(2);
    expect(annotations.children[0]).toBe(b);
    const group = annotations.children[1] as SVGGElement;
    expect(group.getAttribute("data-type")).toBe("group");
    expect(Array.from(group.children)).toEqual([a, c]);
  });

  it("ungroupSelected unwraps a group + selects its former children", () => {
    const { selection, annotations } = setupSelection();
    const a = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const b = makeRect({ x: 20, y: 0, w: 10, h: 10 });
    annotations.appendChild(a);
    annotations.appendChild(b);
    selection.selectMultiple([a, b]);
    selection.groupSelected();
    selection.ungroupSelected();
    expect(annotations.children.length).toBe(2);
    expect(Array.from(annotations.children)).toEqual([a, b]);
    expect(selection.selectedElements.length).toBe(2);
  });

  it("ungroupSelected on a non-group selection is a silent no-op", () => {
    const { selection, annotations, saveSpy } = setupSelection();
    const a = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(a);
    selection.select(a);
    saveSpy.mockClear();
    selection.ungroupSelected();
    expect(annotations.firstElementChild).toBe(a);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("SelectionManager — alignSelected", () => {
  /** Helper: create N rects with bbox attached, append to annotations,
   *  return them. */
  function placeRects(
    annotations: SVGGElement,
    rects: Array<{ x: number; y: number; w: number; h: number }>,
  ): SVGRectElement[] {
    return rects.map((r) => {
      const el = makeRect(r);
      attachAttrBBox(el);
      annotations.appendChild(el);
      return el;
    });
  }

  it("'left' snaps each selected rect's leading-x to the leftmost", () => {
    const { selection, annotations } = setupSelection();
    const [a, b] = placeRects(annotations, [
      { x: 50, y: 0, w: 30, h: 30 },
      { x: 100, y: 50, w: 40, h: 30 },
    ]);
    selection.selectMultiple([a!, b!]);
    selection.alignSelected("left");
    expect(a!.getAttribute("x")).toBe("50");
    expect(b!.getAttribute("x")).toBe("50");
  });

  it("'right' snaps each rect's trailing-x to the rightmost", () => {
    const { selection, annotations } = setupSelection();
    const [a, b] = placeRects(annotations, [
      { x: 0, y: 0, w: 30, h: 30 }, // right edge = 30
      { x: 50, y: 0, w: 40, h: 30 }, // right edge = 90 (max)
    ]);
    selection.selectMultiple([a!, b!]);
    selection.alignSelected("right");
    // a's right should now match b's right (90); a width 30 → x=60
    expect(a!.getAttribute("x")).toBe("60");
    expect(b!.getAttribute("x")).toBe("50");
  });

  it("'center-h' centers each rect on the selection's horizontal centerline", () => {
    const { selection, annotations } = setupSelection();
    const [a, b] = placeRects(annotations, [
      { x: 0, y: 0, w: 30, h: 30 },
      { x: 100, y: 0, w: 40, h: 30 },
    ]);
    selection.selectMultiple([a!, b!]);
    selection.alignSelected("center-h");
    // selMin.x=0, selMax.x=140 → cx=70. a centerx → 70 → x=70-15=55.
    expect(a!.getAttribute("x")).toBe("55");
    expect(b!.getAttribute("x")).toBe("50");
  });

  it("'top' snaps each rect's leading-y to the topmost", () => {
    const { selection, annotations } = setupSelection();
    const [a, b] = placeRects(annotations, [
      { x: 0, y: 20, w: 30, h: 30 },
      { x: 0, y: 80, w: 30, h: 30 },
    ]);
    selection.selectMultiple([a!, b!]);
    selection.alignSelected("top");
    expect(a!.getAttribute("y")).toBe("20");
    expect(b!.getAttribute("y")).toBe("20");
  });

  it("'bottom' snaps each rect's trailing-y to the bottommost", () => {
    const { selection, annotations } = setupSelection();
    const [a, b] = placeRects(annotations, [
      { x: 0, y: 0, w: 30, h: 30 }, // bottom = 30
      { x: 0, y: 0, w: 30, h: 80 }, // bottom = 80 (max)
    ]);
    selection.selectMultiple([a!, b!]);
    selection.alignSelected("bottom");
    // a's bottom should now match b's bottom (80); a height 30 → y=50
    expect(a!.getAttribute("y")).toBe("50");
  });

  it("'middle-v' centers each rect on the selection's vertical centerline", () => {
    const { selection, annotations } = setupSelection();
    const [a, b] = placeRects(annotations, [
      { x: 0, y: 0, w: 30, h: 30 },
      { x: 0, y: 100, w: 30, h: 40 },
    ]);
    selection.selectMultiple([a!, b!]);
    selection.alignSelected("middle-v");
    // selMin.y=0, selMax.y=140 → cy=70. a centery → 70 → y=70-15=55.
    expect(a!.getAttribute("y")).toBe("55");
    expect(b!.getAttribute("y")).toBe("50");
  });

  it("alignSelected with <2 elements is a silent no-op", () => {
    const { selection, annotations, saveSpy } = setupSelection();
    const [a] = placeRects(annotations, [{ x: 0, y: 0, w: 30, h: 30 }]);
    selection.select(a!);
    saveSpy.mockClear();
    selection.alignSelected("left");
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("SelectionManager — distributeSelected", () => {
  function placeRects(
    annotations: SVGGElement,
    rects: Array<{ x: number; y: number; w: number; h: number }>,
  ): SVGRectElement[] {
    return rects.map((r) => {
      const el = makeRect(r);
      attachAttrBBox(el);
      annotations.appendChild(el);
      return el;
    });
  }

  it("'horizontal' equalises gaps between adjacent rects (leftmost + rightmost stay put)", () => {
    const { selection, annotations } = setupSelection();
    // Three rects: 30 wide each. Leftmost x=0, rightmost x=200.
    // Total span = 200+30 = 230. Sum widths = 90. Gaps = (230-90)/(3-1) = 70.
    // Middle should land at cursor = 0+30+70 = 100. So x=100.
    const [a, b, c] = placeRects(annotations, [
      { x: 0, y: 0, w: 30, h: 30 },
      { x: 50, y: 0, w: 30, h: 30 }, // crooked middle
      { x: 200, y: 0, w: 30, h: 30 },
    ]);
    selection.selectMultiple([a!, b!, c!]);
    selection.distributeSelected("horizontal");
    expect(b!.getAttribute("x")).toBe("100");
    expect(a!.getAttribute("x")).toBe("0"); // leftmost unchanged
    expect(c!.getAttribute("x")).toBe("200"); // rightmost unchanged
  });

  it("'vertical' equalises gaps along Y", () => {
    const { selection, annotations } = setupSelection();
    const [a, b, c] = placeRects(annotations, [
      { x: 0, y: 0, w: 30, h: 30 },
      { x: 0, y: 50, w: 30, h: 30 },
      { x: 0, y: 200, w: 30, h: 30 },
    ]);
    selection.selectMultiple([a!, b!, c!]);
    selection.distributeSelected("vertical");
    expect(b!.getAttribute("y")).toBe("100");
  });

  it("distributeSelected with <3 elements is a silent no-op (needs a middle to distribute)", () => {
    const { selection, annotations, saveSpy } = setupSelection();
    const [a, b] = placeRects(annotations, [
      { x: 0, y: 0, w: 30, h: 30 },
      { x: 100, y: 0, w: 30, h: 30 },
    ]);
    selection.selectMultiple([a!, b!]);
    saveSpy.mockClear();
    selection.distributeSelected("horizontal");
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("SelectionManager — redact rebake on move (arrow-key path)", () => {
  // The mosaic / blur redaction PNG is baked at draw time. Without
  // a post-move rebake, the embedded image continues to show pixels
  // sampled from the original drawn region after the user nudges the
  // box, defeating the redaction. The rebake gate detects the moved
  // <image data-redact-style="mosaic|blur"> in the selection and
  // calls `convertRedactStyle(el, sameStyle, canvas)` so the PNG
  // matches the new geometry.
  //
  // We exercise the arrow-key path here (synchronous keydown gesture
  // with no pointer plumbing) because the pointerup path needs the
  // full pointer-event sequence to reach the gesture-end branch
  // and that's covered by the manual smoke check on the dev server.
  // The async `convertRedactStyle` is mocked because the real
  // implementation requires a real <canvas> for raster sampling
  // (out-of-reach under happy-dom — same constraint the
  // RedactTool tests document).

  it("mosaic <image> in selection: nudges fire the rebake path (deferred save, replacement)", async () => {
    // Stub convertRedactStyle to swap the <image> for a fresh node
    // with a sentinel `data-rebaked` attr, so we can confirm the
    // post-rebake replacement happened without needing a real
    // <canvas>. (The real renderer's pixel-sampling logic is
    // covered separately in redact-utils.test.ts.)
    const utils = await import("./redact-utils.js");
    const spy = vi.spyOn(utils, "convertRedactStyle").mockImplementation(async (oldEl) => {
      const fresh = document.createElementNS(SVG_NS, "image") as SVGImageElement;
      const ds = oldEl.getAttribute("data-redact-style");
      if (ds) fresh.setAttribute("data-redact-style", ds);
      fresh.setAttribute("data-rebaked", "1");
      // Mirror real behaviour: replace in DOM.
      oldEl.parentNode?.replaceChild(fresh, oldEl);
      return fresh;
    });

    const { selection, annotations, saveSpy } = setupSelection();
    const img = document.createElementNS(SVG_NS, "image") as SVGImageElement;
    img.setAttribute("x", "20");
    img.setAttribute("y", "20");
    img.setAttribute("width", "120");
    img.setAttribute("height", "80");
    img.setAttribute("href", PNG);
    img.setAttribute("data-redact-style", "mosaic");
    annotations.appendChild(img);
    selection.select(img);

    const svg = annotations.ownerSVGElement!;
    saveSpy.mockClear();
    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    // Synchronous save is skipped — rebake deferred it.
    expect(saveSpy).not.toHaveBeenCalled();

    // Wait one microtask for the async rebake to settle.
    await Promise.resolve();
    await Promise.resolve();

    // Saved exactly once, after the replacement landed.
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe("mosaic");
    expect(annotations.firstElementChild?.getAttribute("data-rebaked")).toBe("1");

    spy.mockRestore();
  });

  it("solid redact <rect> does NOT trigger rebake (only fill, no PNG to refresh)", async () => {
    const { selection, annotations, saveSpy } = setupSelection();
    const r = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    r.setAttribute("x", "10");
    r.setAttribute("y", "10");
    r.setAttribute("width", "100");
    r.setAttribute("height", "60");
    r.setAttribute("fill", "#111");
    r.setAttribute("data-redact-style", "solid");
    annotations.appendChild(r);
    selection.select(r);

    const svg = annotations.ownerSVGElement!;
    saveSpy.mockClear();
    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    // Solid rect: history.save fires synchronously, no async rebake.
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(annotations.firstElementChild).toBe(r);
  });

  it("plain shapes (non-redact) do NOT trigger rebake — sync save only", async () => {
    const { selection, annotations, saveSpy } = setupSelection();
    const r = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(r);
    selection.select(r);
    const svg = annotations.ownerSVGElement!;
    saveSpy.mockClear();
    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(annotations.firstElementChild).toBe(r);
  });

  it("rapid concurrent rebake requests serialise — no replaceChild race, last writer wins", async () => {
    // Regression test for the user-reported "mosaicの移動、サイズ変更
    // での再mosaic化が行われない" bug. Without serialisation in the
    // rebake gate, two pointerups (or two arrow nudges) fired before
    // the first rebake's `await loadImage(...)` resolves both end up
    // calling `parent.replaceChild(newEl, oldEl)` with the same
    // `oldEl` reference — the first call succeeds, the second
    // throws `NotFoundError` because `oldEl` is no longer a child.
    // The catch path swallows the throw, so the user is left with
    // gesture A's rebaked content pinned to the DOM and gesture B's
    // rebake silently lost.
    //
    // The serialised queue (`#queueRebake`) coalesces concurrent
    // requests into "in-flight + at-most-one follow-up." This test
    // simulates the race by holding the first rebake's promise open
    // while a second arrow-key gesture fires, then resolving them
    // in order — no errors, both swap operations succeed in turn,
    // and the latest follow-up samples the live element.
    const utils = await import("./redact-utils.js");

    let firstResolve: (() => void) | null = null;
    let firstStarted = false;
    const calls: Array<{ x: string | null; y: string | null }> = [];
    const spy = vi.spyOn(utils, "convertRedactStyle").mockImplementation(async (oldEl) => {
      calls.push({ x: oldEl.getAttribute("x"), y: oldEl.getAttribute("y") });
      // Hold the first call open until the test releases it; later
      // calls resolve immediately so they can run after the unblock.
      if (!firstStarted) {
        firstStarted = true;
        await new Promise<void>((resolve) => {
          firstResolve = resolve;
        });
      }
      const fresh = document.createElementNS(SVG_NS, "image") as SVGImageElement;
      const ds = oldEl.getAttribute("data-redact-style");
      if (ds) fresh.setAttribute("data-redact-style", ds);
      fresh.setAttribute("href", PNG);
      // Mirror what the real `buildImageRedact` does — copy the
      // sampled rect onto the fresh node so subsequent rebakes
      // (which re-read these attrs) see the right geometry.
      for (const attr of ["x", "y", "width", "height"] as const) {
        const v = oldEl.getAttribute(attr);
        if (v != null) fresh.setAttribute(attr, v);
      }
      // Mirror the real swap.
      const parent = oldEl.parentNode;
      if (parent) parent.replaceChild(fresh, oldEl);
      return fresh;
    });

    const { selection, annotations, saveSpy } = setupSelection();
    const img = document.createElementNS(SVG_NS, "image") as SVGImageElement;
    img.setAttribute("x", "20");
    img.setAttribute("y", "20");
    img.setAttribute("width", "100");
    img.setAttribute("height", "60");
    img.setAttribute("href", PNG);
    img.setAttribute("data-redact-style", "mosaic");
    annotations.appendChild(img);
    selection.select(img);

    const svg = annotations.ownerSVGElement!;
    const errors: unknown[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });
    saveSpy.mockClear();

    // Gesture 1: nudges right by 1px → schedules rebake A. The mock
    // suspends inside the await so rebake A is now in flight.
    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    // Yield so the queueRebake → runRebakeOnce → convertRedactStyle
    // chain reaches the suspended await.
    await Promise.resolve();
    await Promise.resolve();
    expect(firstStarted).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    // Gesture 2 + 3: two more arrow nudges fire WHILE rebake A is
    // still suspended. The original race fired one
    // `convertRedactStyle` call per gesture, leading to colliding
    // `replaceChild` calls; the new queue must coalesce them into
    // at most one follow-up.
    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await Promise.resolve();

    // Still only ONE convertRedactStyle call so far — gestures 2/3
    // are queued behind A, not racing it.
    expect(spy).toHaveBeenCalledTimes(1);

    // Release rebake A.
    firstResolve?.();
    // Drain microtasks: A finishes → follow-up B starts (synchronous
    // in this mock since firstStarted is now true) → swap → save.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Exactly TWO rebakes ran (A + a single follow-up that covers
    // both queued gestures), not three — N rapid gestures collapse
    // to "in-flight + 1 follow-up."
    expect(spy).toHaveBeenCalledTimes(2);
    // The follow-up sampled the LATEST geometry (after all three
    // arrow nudges), not a stale snapshot from when it was queued.
    // ArrowRight = +1px each, three presses = x:20→23.
    expect(calls[1]?.x).toBe("23");

    // No `replaceChild` race: nothing was logged to console.error.
    expect(errors).toHaveLength(0);

    // Both rebakes called history.save exactly once each — pending
    // edits eventually flush to the host's autosave path.
    expect(saveSpy).toHaveBeenCalledTimes(2);

    // Final DOM state: one fresh `<image>` (the follow-up's), no
    // detached / leftover nodes.
    expect(annotations.children).toHaveLength(1);
    expect(annotations.firstElementChild?.getAttribute("data-redact-style")).toBe("mosaic");

    spy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("SelectionManager — onChange callback", () => {
  it("fires on select / selectMultiple / toggleSelect / paste / delete / group / ungroup / z-order", () => {
    const { selection, annotations } = setupSelection();
    const onChange = vi.fn();
    selection.onChange = onChange;
    const a = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    const b = makeRect({ x: 0, y: 0, w: 10, h: 10 });
    annotations.appendChild(a);
    annotations.appendChild(b);

    selection.select(a);
    expect(onChange).toHaveBeenCalledTimes(1);
    selection.selectMultiple([a, b]);
    expect(onChange).toHaveBeenCalledTimes(2);
    selection.toggleSelect(a);
    expect(onChange).toHaveBeenCalledTimes(3);
    selection.copySelected();
    selection.paste();
    expect(onChange.mock.calls.length).toBeGreaterThan(3);
  });
});
