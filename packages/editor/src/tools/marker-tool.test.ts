/**
 * @vitest-environment happy-dom
 *
 * MarkerTool — single-click counter / badge tool. The behavioural
 * surface:
 *
 *   - pointerdown places a `<g data-marker="N">` with a circle/rect
 *     bg + a numeric label centred at the click point. The bg shape
 *     comes from `options.markerShape` (`circle` / `rect` /
 *     `rounded`); the badge size is `fontSize * 0.8`.
 *   - The counter value (the digit on the badge) auto-increments:
 *     each new marker takes max(existing markers with same color +
 *     shape + fontSize) + 1.
 *   - The "fillColor=none" sentinel falls back to the red default so
 *     the badge isn't invisible.
 *   - The rounded variant gets a generous corner radius (~r * 0.6);
 *     the sharp rect gets a fixed 3pt corner.
 *   - history.save + onShapeComplete fire on the same pointerdown
 *     (single-click placement, no drag).
 *
 * Plus the auxiliary helpers `detectMarkerShape`, `convertMarkerShape`,
 * `resizeMarker` for the property-panel paths.
 */

import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import { describe, expect, it, vi } from "vitest";
import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";
import {
  convertMarkerShape,
  detectMarkerShape,
  MarkerTool,
  resizeMarker,
} from "./marker-tool.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeCanvas(): { canvas: CanvasManager; annotations: SVGGElement } {
  const annotations = document.createElementNS(SVG_NS, "g") as SVGGElement;
  return { canvas: { annotations } as unknown as CanvasManager, annotations };
}

function makeHistory(): { history: History; save: ReturnType<typeof vi.fn> } {
  const save = vi.fn();
  return { history: { save } as unknown as History, save };
}

function makeOptions(overrides: Partial<ToolOptions> = {}): ToolOptions {
  return {
    strokeColor: "#ffffff",
    fillColor: "#ff0000",
    strokeWidth: 1.5,
    fontSize: 16,
    strokeDasharray: "",
    fillOpacity: 1,
    markerShape: "circle",
    ...overrides,
  };
}

function pointerEvent(): PointerEvent {
  const Ctor =
    typeof PointerEvent === "function" ? PointerEvent : (MouseEvent as typeof PointerEvent);
  return new Ctor("pointerdown", { bubbles: true });
}

describe("MarkerTool — placement on pointerdown", () => {
  it("creates a <g data-marker='1'> at the click point", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(canvas, history, makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 60));
    expect(annotations.children.length).toBe(1);
    const g = annotations.firstElementChild!;
    expect(g.tagName.toLowerCase()).toBe("g");
    expect(g.getAttribute("data-marker")).toBe("1");
  });

  it("uses circle bg by default, sized by fontSize × 0.8", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(canvas, history, makeOptions({ fontSize: 20 }));
    tool.onPointerDown(pointerEvent(), new DOMPoint(100, 200));
    const circle = annotations.querySelector("circle")!;
    expect(circle.getAttribute("cx")).toBe("100");
    expect(circle.getAttribute("cy")).toBe("200");
    expect(circle.getAttribute("r")).toBe("16"); // 20 * 0.8
    expect(circle.getAttribute("fill")).toBe("#ff0000");
  });

  it("renders a sharp rect bg when markerShape='rect' (corner radius = 3)", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(canvas, history, makeOptions({ markerShape: "rect" }));
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 60));
    const rect = annotations.querySelector("rect")!;
    expect(rect.getAttribute("rx")).toBe("3");
    expect(annotations.firstElementChild!.getAttribute("data-shape")).toBe("rect");
  });

  it("renders a rounded rect when markerShape='rounded' (corner radius = r × 0.6)", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(canvas, history, makeOptions({ markerShape: "rounded", fontSize: 20 }));
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 60));
    const rect = annotations.querySelector("rect")!;
    // r = 20 * 0.8 = 16, corner = 16 * 0.6 = 9.6
    expect(Number(rect.getAttribute("rx"))).toBeCloseTo(9.6, 5);
    expect(annotations.firstElementChild!.getAttribute("data-shape")).toBe("rounded");
  });

  it("falls back to red when fillColor is the 'none' sentinel (counter wouldn't be visible)", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(canvas, history, makeOptions({ fillColor: "none" }));
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    expect(annotations.querySelector("circle")!.getAttribute("fill")).toBe("#ff0000");
  });

  it("falls back to red when fillColor is empty / null-like", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(canvas, history, makeOptions({ fillColor: "" }));
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    expect(annotations.querySelector("circle")!.getAttribute("fill")).toBe("#ff0000");
  });

  it("uses options.strokeColor + strokeWidth on the bg border", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(
      canvas,
      history,
      makeOptions({ strokeColor: "#0000ff", strokeWidth: 4 }),
    );
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    const circle = annotations.querySelector("circle")!;
    expect(circle.getAttribute("stroke")).toBe("#0000ff");
    expect(circle.getAttribute("stroke-width")).toBe("4");
  });

  it("emits stroke-dasharray + data-dash-key when set, omits both when blank", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(canvas, history, makeOptions({ strokeDasharray: "dot" }));
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    const circle = annotations.querySelector("circle")!;
    expect(circle.getAttribute("stroke-dasharray")).toBe("dot");
    expect(circle.getAttribute("data-dash-key")).toBe("dot");
  });

  it("text label has font-size matching options + standard centred alignment", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(canvas, history, makeOptions({ fontSize: 24 }));
    tool.onPointerDown(pointerEvent(), new DOMPoint(80, 90));
    const text = annotations.querySelector("text")!;
    expect(text.getAttribute("font-size")).toBe("24");
    expect(text.getAttribute("text-anchor")).toBe("middle");
    expect(text.getAttribute("dominant-baseline")).toBe("central");
    expect(text.textContent).toBe("1");
    expect(text.getAttribute("x")).toBe("80");
    expect(text.getAttribute("y")).toBe("90");
  });

  it("saves history + fires onShapeComplete on the same single click", () => {
    const { canvas, annotations } = makeCanvas();
    const { history, save } = makeHistory();
    const tool = new MarkerTool(canvas, history, makeOptions());
    const onShapeComplete = vi.fn();
    tool.onShapeComplete = onShapeComplete;
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    expect(save).toHaveBeenCalledTimes(1);
    expect(onShapeComplete).toHaveBeenCalledTimes(1);
    expect(onShapeComplete.mock.calls[0]![0]).toBe(annotations.firstElementChild);
  });

  it("pointermove + pointerup are no-ops (single-click tool)", () => {
    const { canvas, annotations } = makeCanvas();
    const { history, save } = makeHistory();
    const tool = new MarkerTool(canvas, history, makeOptions());
    tool.onPointerMove(pointerEvent(), new DOMPoint(50, 50));
    tool.onPointerUp(pointerEvent(), new DOMPoint(50, 50));
    expect(annotations.children.length).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("MarkerTool — auto-incrementing counter", () => {
  it("second placement of same color/shape/fontSize gets data-marker='2'", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(canvas, history, makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 50));
    expect(annotations.children[0]!.getAttribute("data-marker")).toBe("1");
    expect(annotations.children[1]!.getAttribute("data-marker")).toBe("2");
  });

  it("placements with a different color start a fresh sequence (independent counter)", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool1 = new MarkerTool(canvas, history, makeOptions({ fillColor: "#ff0000" }));
    tool1.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool1.onPointerDown(pointerEvent(), new DOMPoint(50, 50));
    const tool2 = new MarkerTool(canvas, history, makeOptions({ fillColor: "#00ff00" }));
    tool2.onPointerDown(pointerEvent(), new DOMPoint(100, 100));
    expect(annotations.children[2]!.getAttribute("data-marker")).toBe("1");
  });

  it("placements with a different shape start a fresh sequence", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const circleTool = new MarkerTool(canvas, history, makeOptions({ markerShape: "circle" }));
    circleTool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    const rectTool = new MarkerTool(canvas, history, makeOptions({ markerShape: "rect" }));
    rectTool.onPointerDown(pointerEvent(), new DOMPoint(50, 50));
    expect(annotations.children[1]!.getAttribute("data-marker")).toBe("1");
  });

  it("placements with a different fontSize start a fresh sequence", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const small = new MarkerTool(canvas, history, makeOptions({ fontSize: 14 }));
    small.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    const large = new MarkerTool(canvas, history, makeOptions({ fontSize: 24 }));
    large.onPointerDown(pointerEvent(), new DOMPoint(50, 50));
    expect(annotations.children[1]!.getAttribute("data-marker")).toBe("1");
  });
});

describe("detectMarkerShape", () => {
  it("reads the data-shape attribute when set (authoritative)", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(canvas, history, makeOptions({ markerShape: "rounded" }));
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    expect(detectMarkerShape(annotations.firstElementChild as SVGElement)).toBe("rounded");
  });

  it("falls back to the bg primitive tag when data-shape is missing (legacy content)", () => {
    const g = document.createElementNS(SVG_NS, "g");
    const rect = document.createElementNS(SVG_NS, "rect");
    g.appendChild(rect);
    expect(detectMarkerShape(g)).toBe("rect");
  });

  it("defaults to 'circle' when the data attr is unrecognised AND no bg is found", () => {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("data-shape", "weird");
    expect(detectMarkerShape(g)).toBe("circle");
  });
});

describe("convertMarkerShape", () => {
  function makeCircleMarker(): SVGElement {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(
      canvas,
      history,
      makeOptions({ markerShape: "circle", fontSize: 20 }),
    );
    tool.onPointerDown(pointerEvent(), new DOMPoint(100, 100));
    return annotations.firstElementChild as SVGElement;
  }

  it("returns the same <g> when the requested shape matches the current one (no work)", () => {
    const g = makeCircleMarker();
    const before = g.outerHTML;
    const after = convertMarkerShape(g, "circle");
    expect(after).toBe(g);
    expect(g.outerHTML).toBe(before);
  });

  it("circle → rect: replaces the bg primitive in place + updates data-shape", () => {
    const g = makeCircleMarker();
    convertMarkerShape(g, "rect");
    expect(g.querySelector("circle")).toBeNull();
    const rect = g.querySelector("rect")!;
    expect(rect.getAttribute("rx")).toBe("3");
    expect(g.getAttribute("data-shape")).toBe("rect");
  });

  it("circle → rounded: rect with rx = r × 0.6 (preserves the rounded distinction)", () => {
    const g = makeCircleMarker();
    convertMarkerShape(g, "rounded");
    const rect = g.querySelector("rect")!;
    // r=16, rx = 16 * 0.6 = 9.6
    expect(Number(rect.getAttribute("rx"))).toBeCloseTo(9.6, 5);
    expect(g.getAttribute("data-shape")).toBe("rounded");
  });

  it("rect → circle: derives center / radius from the rect's geometry", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(
      canvas,
      history,
      makeOptions({ markerShape: "rect", fontSize: 20 }),
    );
    tool.onPointerDown(pointerEvent(), new DOMPoint(100, 100));
    const g = annotations.firstElementChild as SVGElement;
    convertMarkerShape(g, "circle");
    const circle = g.querySelector("circle")!;
    expect(Number(circle.getAttribute("cx"))).toBeCloseTo(100, 5);
    expect(Number(circle.getAttribute("cy"))).toBeCloseTo(100, 5);
    expect(Number(circle.getAttribute("r"))).toBeCloseTo(16, 5);
  });

  it("preserves fill / stroke / stroke-width across the swap", () => {
    const g = makeCircleMarker();
    g.querySelector("circle")!.setAttribute("fill", "#abcdef");
    g.querySelector("circle")!.setAttribute("stroke", "#123456");
    g.querySelector("circle")!.setAttribute("stroke-width", "5");
    convertMarkerShape(g, "rect");
    const rect = g.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("#abcdef");
    expect(rect.getAttribute("stroke")).toBe("#123456");
    expect(rect.getAttribute("stroke-width")).toBe("5");
  });

  it("returns the <g> unchanged when the marker has no bg primitive (defensive)", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGElement;
    expect(convertMarkerShape(g, "rect")).toBe(g);
  });
});

describe("resizeMarker", () => {
  function makeCircleMarker(fontSize = 20): SVGElement {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(
      canvas,
      history,
      makeOptions({ markerShape: "circle", fontSize }),
    );
    tool.onPointerDown(pointerEvent(), new DOMPoint(100, 100));
    return annotations.firstElementChild as SVGElement;
  }

  it("scales a circle bg's r + the text's font-size to the new value", () => {
    const g = makeCircleMarker(20);
    resizeMarker(g, 30);
    expect(Number(g.querySelector("circle")!.getAttribute("r"))).toBeCloseTo(24, 5); // 30 * 0.8
    expect(g.querySelector("text")!.getAttribute("font-size")).toBe("30");
    expect(g.getAttribute("data-font-size")).toBe("30");
  });

  it("recenters the bg around the existing center (visual anchor unchanged)", () => {
    const g = makeCircleMarker(20);
    resizeMarker(g, 30);
    const circle = g.querySelector("circle")!;
    expect(Number(circle.getAttribute("cx"))).toBeCloseTo(100, 5);
    expect(Number(circle.getAttribute("cy"))).toBeCloseTo(100, 5);
  });

  it("scales a rounded rect bg AND keeps the r × 0.6 corner ratio", () => {
    const { canvas, annotations } = makeCanvas();
    const { history } = makeHistory();
    const tool = new MarkerTool(
      canvas,
      history,
      makeOptions({ markerShape: "rounded", fontSize: 20 }),
    );
    tool.onPointerDown(pointerEvent(), new DOMPoint(100, 100));
    const g = annotations.firstElementChild as SVGElement;
    resizeMarker(g, 30);
    const rect = g.querySelector("rect")!;
    // r=24 → side=48, corner=24*0.6=14.4
    expect(Number(rect.getAttribute("width"))).toBeCloseTo(48, 5);
    expect(Number(rect.getAttribute("rx"))).toBeCloseTo(14.4, 5);
  });

  it("is a no-op when the marker has no bg primitive (defensive)", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGElement;
    expect(() => resizeMarker(g, 30)).not.toThrow();
  });
});
