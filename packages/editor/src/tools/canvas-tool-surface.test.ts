/**
 * @vitest-environment happy-dom
 *
 * `createCanvasToolSurface` adapts a `CanvasManager` + `History`
 * pair into the three-method `ToolDOMSurface` contract every tool
 * depends on. Tiny adapter — three methods, each one a one-liner —
 * so the tests just verify the wiring:
 *
 *   - `attachDraft(el)` appends to `canvas.annotations` WITHOUT
 *     calling history.save() (in-flight elements aren't committed).
 *   - `addAnnotation(el)` appends to `canvas.annotations` AND
 *     calls history.save() (atomic click-to-create).
 *   - `saveHistory()` only calls history.save() (mid-gesture
 *     commits where the element is already attached).
 */

import { describe, expect, it, vi } from "vitest";
import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";
import { createCanvasToolSurface } from "./canvas-tool-surface.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeAnnotationsGroup(): SVGGElement {
  return document.createElementNS(SVG_NS, "g") as SVGGElement;
}

function makeRect(): SVGRectElement {
  return document.createElementNS(SVG_NS, "rect") as SVGRectElement;
}

interface CanvasStub {
  annotations: SVGGElement;
}

interface HistoryStub {
  save: ReturnType<typeof vi.fn>;
}

function buildSurface(): {
  canvas: CanvasStub;
  history: HistoryStub;
  surface: ReturnType<typeof createCanvasToolSurface>;
} {
  const canvas: CanvasStub = { annotations: makeAnnotationsGroup() };
  const history: HistoryStub = { save: vi.fn() };
  const surface = createCanvasToolSurface(
    canvas as unknown as CanvasManager,
    history as unknown as History,
  );
  return { canvas, history, surface };
}

describe("createCanvasToolSurface — attachDraft", () => {
  it("appends the element to canvas.annotations", () => {
    const { canvas, surface } = buildSurface();
    const el = makeRect();
    surface.attachDraft(el);
    expect(canvas.annotations.children.length).toBe(1);
    expect(canvas.annotations.children[0]).toBe(el);
  });

  it("does NOT call history.save (drafts are in-flight, not committed)", () => {
    const { history, surface } = buildSurface();
    surface.attachDraft(makeRect());
    expect(history.save).not.toHaveBeenCalled();
  });

  it("repeated calls accumulate children in the order they were attached", () => {
    const { canvas, surface } = buildSurface();
    const a = makeRect();
    const b = makeRect();
    surface.attachDraft(a);
    surface.attachDraft(b);
    expect(Array.from(canvas.annotations.children)).toEqual([a, b]);
  });
});

describe("createCanvasToolSurface — addAnnotation", () => {
  it("appends the element AND calls history.save (atomic commit)", () => {
    const { canvas, history, surface } = buildSurface();
    const el = makeRect();
    surface.addAnnotation(el);
    expect(canvas.annotations.children.length).toBe(1);
    expect(canvas.annotations.children[0]).toBe(el);
    expect(history.save).toHaveBeenCalledTimes(1);
  });

  it("two click-to-creates → two children + two saves", () => {
    const { canvas, history, surface } = buildSurface();
    surface.addAnnotation(makeRect());
    surface.addAnnotation(makeRect());
    expect(canvas.annotations.children.length).toBe(2);
    expect(history.save).toHaveBeenCalledTimes(2);
  });
});

describe("createCanvasToolSurface — saveHistory", () => {
  it("calls history.save without touching the DOM", () => {
    const { canvas, history, surface } = buildSurface();
    surface.saveHistory();
    expect(history.save).toHaveBeenCalledTimes(1);
    expect(canvas.annotations.children.length).toBe(0);
  });
});

describe("createCanvasToolSurface — drag-then-commit lifecycle", () => {
  it("attachDraft + saveHistory mirrors the freehand / arrow drag-end pattern (1 child + 1 save)", () => {
    const { canvas, history, surface } = buildSurface();
    const el = makeRect();
    surface.attachDraft(el);
    expect(history.save).not.toHaveBeenCalled();
    surface.saveHistory();
    expect(canvas.annotations.children.length).toBe(1);
    expect(history.save).toHaveBeenCalledTimes(1);
  });
});
