/**
 * @vitest-environment happy-dom
 *
 * `History` is the browser-side wrapper around Tier B's
 * `createHistoryCore`: it adapts the abstract get/set-snapshot
 * contract onto an SVG `<g>` element via `innerHTML` round-trips.
 * The stack semantics (depth cap, redo invalidation, save-then-
 * undo edge cases) live in `core/editor/history-core` and are
 * already exhaustively unit-tested there. The job of THIS test
 * file is to pin the DOM-side bridging: snapshots actually move
 * the SVG content, undo / redo restore it, and the
 * `onStateChange` / `onChange` callbacks fire at the right
 * moments.
 */

import { describe, expect, it, vi } from "vitest";
import { History } from "./history.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeAnnotationsGroup(initialHtml = ""): SVGGElement {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  document.body.appendChild(svg);
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.id = "annotations";
  if (initialHtml) g.innerHTML = initialHtml;
  svg.appendChild(g);
  return g;
}

/** Read the first <rect>'s `width` attribute — used as a stable
 *  identity marker across save / undo / redo round-trips. happy-dom
 *  serialises `<rect/>` as `<rect></rect>`, so direct innerHTML
 *  string comparisons are brittle; structural reads aren't. */
function rectWidth(g: SVGGElement): string | null {
  return g.querySelector("rect")?.getAttribute("width") ?? null;
}

describe("History — initial state", () => {
  it("seeds the history with the live innerHTML on construction", () => {
    const g = makeAnnotationsGroup('<rect width="10" height="10"/>');
    const h = new History(g);
    // Seed snapshot can't be undone (it's the initial state).
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it("fires onStateChange once for the seed save", () => {
    const onStateChange = vi.fn();
    const g = makeAnnotationsGroup();
    const h = new History(g);
    h.onStateChange = onStateChange;
    // Seed already happened in the constructor — onStateChange wasn't
    // registered yet, so the seed call doesn't reach the spy. After
    // a real save, it does.
    g.innerHTML = '<rect width="20" height="20"/>';
    h.save();
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });
});

describe("History — save / undo / redo round-trip", () => {
  it("undo restores the previously-saved innerHTML", () => {
    const g = makeAnnotationsGroup();
    const h = new History(g);
    g.innerHTML = '<rect width="10" height="10"/>';
    h.save();
    g.innerHTML = '<rect width="20" height="20"/>';
    h.save();
    expect(h.canUndo).toBe(true);
    h.undo();
    expect(rectWidth(g)).toBe("10");
  });

  it("redo re-applies an undone snapshot", () => {
    const g = makeAnnotationsGroup();
    const h = new History(g);
    g.innerHTML = '<rect width="10" height="10"/>';
    h.save();
    g.innerHTML = '<rect width="20" height="20"/>';
    h.save();
    h.undo();
    expect(h.canRedo).toBe(true);
    h.redo();
    expect(rectWidth(g)).toBe("20");
  });

  it("undo at the seed boundary is a no-op (canUndo stays false)", () => {
    const g = makeAnnotationsGroup('<rect width="10" height="10"/>');
    const h = new History(g);
    h.undo();
    expect(rectWidth(g)).toBe("10");
    expect(h.canUndo).toBe(false);
  });

  it("a fresh save after undo invalidates the redo stack", () => {
    const g = makeAnnotationsGroup();
    const h = new History(g);
    g.innerHTML = '<rect width="10" height="10"/>';
    h.save();
    g.innerHTML = '<rect width="20" height="20"/>';
    h.save();
    h.undo();
    g.innerHTML = '<rect width="30" height="30"/>';
    h.save();
    expect(h.canRedo).toBe(false);
    h.undo();
    expect(rectWidth(g)).toBe("10");
  });
});

describe("History — onChange / onStateChange wiring", () => {
  it("calls the constructor `onChange` callback after every undo / redo (the History adapter wires onRestore through it)", () => {
    const onChange = vi.fn();
    const g = makeAnnotationsGroup();
    const h = new History(g, onChange);
    g.innerHTML = '<rect width="10"/>';
    h.save();
    g.innerHTML = '<rect width="20"/>';
    h.save();
    h.undo();
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    h.redo();
    expect(onChange).toHaveBeenCalled();
  });

  it("`onChange` is NOT called on `save()` (only on undo/redo restores)", () => {
    const onChange = vi.fn();
    const g = makeAnnotationsGroup();
    const h = new History(g, onChange);
    g.innerHTML = '<rect width="10"/>';
    h.save();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("`onStateChange` fires on save AND on undo/redo (covers any state-machine transition)", () => {
    const onStateChange = vi.fn();
    const g = makeAnnotationsGroup();
    const h = new History(g);
    h.onStateChange = onStateChange;
    g.innerHTML = '<rect width="10"/>';
    h.save();
    expect(onStateChange).toHaveBeenCalledTimes(1);
    g.innerHTML = '<rect width="20"/>';
    h.save();
    expect(onStateChange).toHaveBeenCalledTimes(2);
    h.undo();
    expect(onStateChange).toHaveBeenCalledTimes(3);
    h.redo();
    expect(onStateChange).toHaveBeenCalledTimes(4);
  });

  it("setting `onStateChange = undefined` later silences subsequent fires", () => {
    const onStateChange = vi.fn();
    const g = makeAnnotationsGroup();
    const h = new History(g);
    h.onStateChange = onStateChange;
    g.innerHTML = '<rect width="10"/>';
    h.save();
    expect(onStateChange).toHaveBeenCalledTimes(1);
    h.onStateChange = undefined;
    g.innerHTML = '<rect width="20"/>';
    h.save();
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });
});

describe("History — DOM bridging integrity", () => {
  it("undoing into an empty seed restores the empty state without crashing", () => {
    const g = makeAnnotationsGroup();
    const h = new History(g);
    g.innerHTML = '<rect width="10"/>';
    h.save();
    h.undo();
    expect(g.children.length).toBe(0);
    expect(g.innerHTML.trim()).toBe("");
  });
});
