/**
 * @vitest-environment happy-dom
 *
 * ShapeTool driven against `createMockToolSurface` — proves the
 * Proposal 3 abstraction unlocks unit-testing a tool's pointer
 * lifecycle without standing up a CanvasManager / History.
 */

import { createMockToolSurface } from "@ingcreators/annot-core/editor/tool-lifecycle";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import { describe, expect, it } from "vitest";
import { ShapeTool } from "./shape-tool.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeOptions(overrides: Partial<ToolOptions> = {}): ToolOptions {
  return {
    strokeColor: "#000000",
    fillColor: "#ffffff",
    strokeWidth: 2,
    fontSize: 16,
    strokeDasharray: "",
    fillOpacity: 1,
    shapeType: "rect",
    ...overrides,
  };
}

function makePoint(x: number, y: number): DOMPoint {
  return new DOMPoint(x, y);
}

function makePointerEvent(opts: { shiftKey?: boolean } = {}): PointerEvent {
  // happy-dom's PointerEvent constructor accepts the standard init.
  return new PointerEvent("pointerdown", {
    bubbles: true,
    shiftKey: opts.shiftKey ?? false,
  });
}

function makeHost(): SVGGElement {
  return document.createElementNS(SVG_NS, "g");
}

describe("ShapeTool — drag to draw a rectangle", () => {
  it("attaches one rect on pointerdown and saves history on pointerup", () => {
    const host = makeHost();
    const surface = createMockToolSurface(host);
    const tool = new ShapeTool(surface, makeOptions({ shapeType: "rect" }));

    tool.onPointerDown(makePointerEvent(), makePoint(10, 20));
    expect(surface.drafts).toHaveLength(1);
    expect(surface.saveCount).toBe(0); // not yet committed

    tool.onPointerMove(makePointerEvent(), makePoint(60, 80));
    // Mid-drag the same draft is being mutated, no new attaches.
    expect(surface.drafts).toHaveLength(1);

    tool.onPointerUp(makePointerEvent(), makePoint(60, 80));
    // Committed: history saved once.
    expect(surface.saveCount).toBe(1);
    // The element stays attached to the host.
    expect(host.children).toHaveLength(1);
  });

  it("rect dimensions reflect the drag rectangle from start → end point", () => {
    const host = makeHost();
    const surface = createMockToolSurface(host);
    const tool = new ShapeTool(surface, makeOptions({ shapeType: "rect" }));

    tool.onPointerDown(makePointerEvent(), makePoint(10, 20));
    tool.onPointerMove(makePointerEvent(), makePoint(60, 80));
    tool.onPointerUp(makePointerEvent(), makePoint(60, 80));

    const rect = host.firstElementChild!;
    expect(rect.tagName.toLowerCase()).toBe("rect");
    expect(rect.getAttribute("x")).toBe("10");
    expect(rect.getAttribute("y")).toBe("20");
    expect(rect.getAttribute("width")).toBe("50");
    expect(rect.getAttribute("height")).toBe("60");
  });

  it("applies the tool's stroke + fill options to the drawn rect", () => {
    const host = makeHost();
    const surface = createMockToolSurface(host);
    const tool = new ShapeTool(
      surface,
      makeOptions({
        shapeType: "rect",
        strokeColor: "#ff0000",
        strokeWidth: 4,
        fillColor: "#00ff00",
        fillOpacity: 0.5,
      }),
    );

    tool.onPointerDown(makePointerEvent(), makePoint(0, 0));
    tool.onPointerMove(makePointerEvent(), makePoint(10, 10));
    tool.onPointerUp(makePointerEvent(), makePoint(10, 10));

    const rect = host.firstElementChild!;
    expect(rect.getAttribute("stroke")).toBe("#ff0000");
    expect(rect.getAttribute("stroke-width")).toBe("4");
    expect(rect.getAttribute("fill")).toBe("#00ff00");
    expect(rect.getAttribute("fill-opacity")).toBe("0.5");
  });

  it("constrains to a square when shift is held during the drag", () => {
    const host = makeHost();
    const surface = createMockToolSurface(host);
    const tool = new ShapeTool(surface, makeOptions({ shapeType: "rect" }));

    tool.onPointerDown(makePointerEvent({ shiftKey: true }), makePoint(0, 0));
    // 50×100 drag with shift held → both dimensions should equal 100.
    tool.onPointerMove(makePointerEvent({ shiftKey: true }), makePoint(50, 100));
    tool.onPointerUp(makePointerEvent({ shiftKey: true }), makePoint(50, 100));

    const rect = host.firstElementChild!;
    expect(rect.getAttribute("width")).toBe("100");
    expect(rect.getAttribute("height")).toBe("100");
  });

  it("discards a too-small drag (< 3px) without saving history", () => {
    const host = makeHost();
    const surface = createMockToolSurface(host);
    const tool = new ShapeTool(surface, makeOptions({ shapeType: "rect" }));

    tool.onPointerDown(makePointerEvent(), makePoint(0, 0));
    tool.onPointerMove(makePointerEvent(), makePoint(2, 2));
    tool.onPointerUp(makePointerEvent(), makePoint(2, 2));

    // Element is removed from the DOM; surface saw the attach but no save.
    expect(host.children).toHaveLength(0);
    expect(surface.saveCount).toBe(0);
  });

  it("fires onShapeComplete with the committed element", () => {
    const host = makeHost();
    const surface = createMockToolSurface(host);
    const tool = new ShapeTool(surface, makeOptions({ shapeType: "rect" }));

    let completed: SVGElement | undefined | null = null;
    tool.onShapeComplete = (el) => {
      completed = el;
    };

    tool.onPointerDown(makePointerEvent(), makePoint(0, 0));
    tool.onPointerMove(makePointerEvent(), makePoint(50, 50));
    tool.onPointerUp(makePointerEvent(), makePoint(50, 50));

    expect(completed).not.toBeNull();
    expect((completed as unknown as Element).tagName.toLowerCase()).toBe("rect");
  });
});

describe("ShapeTool — ellipse variant", () => {
  it("draws an ellipse when shapeType=ellipse", () => {
    const host = makeHost();
    const surface = createMockToolSurface(host);
    const tool = new ShapeTool(surface, makeOptions({ shapeType: "ellipse" }));

    tool.onPointerDown(makePointerEvent(), makePoint(0, 0));
    tool.onPointerMove(makePointerEvent(), makePoint(40, 20));
    tool.onPointerUp(makePointerEvent(), makePoint(40, 20));

    const el = host.firstElementChild!;
    expect(el.tagName.toLowerCase()).toBe("ellipse");
    expect(el.getAttribute("cx")).toBe("20");
    expect(el.getAttribute("cy")).toBe("10");
    // Note: ShapeTool computes radii as Math.abs(delta) / 2.
    expect(el.getAttribute("rx")).toBe("20");
    expect(el.getAttribute("ry")).toBe("10");
  });
});

describe("ShapeTool — rounded variant", () => {
  it("writes data-rounded and a non-zero rx", () => {
    const host = makeHost();
    const surface = createMockToolSurface(host);
    const tool = new ShapeTool(surface, makeOptions({ shapeType: "rounded" }));

    tool.onPointerDown(makePointerEvent(), makePoint(0, 0));
    tool.onPointerMove(makePointerEvent(), makePoint(60, 60));
    tool.onPointerUp(makePointerEvent(), makePoint(60, 60));

    const rect = host.firstElementChild!;
    expect(rect.getAttribute("data-rounded")).toBe("true");
    // Round corner radius = max(2, round(min(w,h)/6)) = round(60/6) = 10.
    expect(rect.getAttribute("rx")).toBe("10");
  });
});
