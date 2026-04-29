/**
 * @vitest-environment happy-dom
 *
 * Regression tests for TextTool. Drives the canvas-form
 * constructor against a minimal duck-typed CanvasManager / History
 * pair so the dblclick listener registration / cleanup can be
 * exercised without a full editor session.
 */
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import { describe, expect, it, vi } from "vitest";
import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";
import { TextTool } from "./text-tool.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeOptions(overrides: Partial<ToolOptions> = {}): ToolOptions {
  return {
    strokeColor: "#000000",
    fillColor: "#ffffff",
    strokeWidth: 2,
    fontSize: 16,
    strokeDasharray: "",
    fillOpacity: 1,
    fontFamily: "sans-serif",
    textVariant: "sticky",
    ...overrides,
  };
}

function makeCanvas(): CanvasManager {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  const annotations = document.createElementNS(SVG_NS, "g") as SVGGElement;
  annotations.id = "annotations";
  svg.appendChild(annotations);
  document.body.appendChild(svg);
  return { svg, annotations } as unknown as CanvasManager;
}

function makeHistory(): History {
  return { save: vi.fn() } as unknown as History;
}

describe("TextTool dblclick listener lifecycle", () => {
  it("attaches one dblclick listener on construction", () => {
    const canvas = makeCanvas();
    const addSpy = vi.spyOn(canvas.svg, "addEventListener");
    new TextTool(canvas, makeHistory(), makeOptions());
    const dblclickRegistrations = addSpy.mock.calls.filter((c) => c[0] === "dblclick");
    expect(dblclickRegistrations).toHaveLength(1);
  });

  it("removes its dblclick listener on onDeactivate", () => {
    const canvas = makeCanvas();
    const addSpy = vi.spyOn(canvas.svg, "addEventListener");
    const removeSpy = vi.spyOn(canvas.svg, "removeEventListener");
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    const addedHandler = addSpy.mock.calls.find((c) => c[0] === "dblclick")?.[1];
    expect(addedHandler).toBeTypeOf("function");

    tool.onDeactivate?.();

    const removedHandler = removeSpy.mock.calls.find((c) => c[0] === "dblclick")?.[1];
    expect(removedHandler).toBe(addedHandler);
  });

  it("multiple TextTool instances each clean up their own listener", () => {
    // Reproduces the production scenario: clicking the Text tool
    // button repeatedly creates a fresh TextTool every time. Without
    // the onDeactivate cleanup, each prior listener stayed armed and
    // a single dblclick fired once per instance — producing the
    // visible "duplicating textbox at original position" symptom the
    // user reported.
    const canvas = makeCanvas();
    const addSpy = vi.spyOn(canvas.svg, "addEventListener");
    const removeSpy = vi.spyOn(canvas.svg, "removeEventListener");
    const t1 = new TextTool(canvas, makeHistory(), makeOptions());
    t1.onDeactivate?.();
    const t2 = new TextTool(canvas, makeHistory(), makeOptions());
    t2.onDeactivate?.();
    const t3 = new TextTool(canvas, makeHistory(), makeOptions());
    t3.onDeactivate?.();

    const dblclickAdds = addSpy.mock.calls.filter((c) => c[0] === "dblclick");
    const dblclickRemoves = removeSpy.mock.calls.filter((c) => c[0] === "dblclick");
    expect(dblclickAdds).toHaveLength(3);
    expect(dblclickRemoves).toHaveLength(3);
    // After all three deactivations, every added handler has a
    // matching remove call so the canvas svg ends up with zero
    // armed dblclick listeners.
    for (const [, handler] of dblclickAdds) {
      const removed = dblclickRemoves.find((c) => c[1] === handler);
      expect(removed, `handler should have been removed`).toBeDefined();
    }
  });
});
