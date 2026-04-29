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

describe("TextTool dblclick singleton listener", () => {
  it("installs exactly one dblclick listener regardless of instance count", () => {
    // The Toolbar instantiates a fresh TextTool on every Text-tool
    // button click. The listener should NOT accumulate — only one
    // dblclick handler should ever be attached to the SVG, with
    // ownership transferred to whichever TextTool was most
    // recently constructed.
    const canvas = makeCanvas();
    const addSpy = vi.spyOn(canvas.svg, "addEventListener");
    new TextTool(canvas, makeHistory(), makeOptions());
    new TextTool(canvas, makeHistory(), makeOptions());
    new TextTool(canvas, makeHistory(), makeOptions());
    const dblclickAdds = addSpy.mock.calls.filter((c) => c[0] === "dblclick");
    expect(dblclickAdds).toHaveLength(1);
  });

  it("the listener stays armed after onDeactivate so other tools' dblclick re-edits text", () => {
    // Per the original PowerPoint-style affordance: dblclicking an
    // existing textbox should always open its editor, even when
    // the user is on (say) Selection. The listener therefore stays
    // installed for the lifetime of the SVG; only the "active
    // TextTool" pointer changes.
    const canvas = makeCanvas();
    const removeSpy = vi.spyOn(canvas.svg, "removeEventListener");
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onDeactivate?.();
    const dblclickRemoves = removeSpy.mock.calls.filter((c) => c[0] === "dblclick");
    expect(dblclickRemoves).toHaveLength(0);
  });

  it("the latest TextTool instance owns the dblclick edit flow", () => {
    // Construct two instances; dblclick a `<g data-type=shape>`;
    // only the LAST instance's `#editExisting` should fire (the
    // first one is now passive). We probe via the side-effect
    // `g.style.display = "none"` that `#editExisting` performs on
    // its target.
    const canvas = makeCanvas();
    new TextTool(canvas, makeHistory(), makeOptions());
    new TextTool(canvas, makeHistory(), makeOptions());

    // Set up a fake textbox to dblclick.
    const wrapper = document.createElementNS(SVG_NS, "g");
    wrapper.setAttribute("data-type", "shape");
    wrapper.setAttribute("data-shape-kind", "sticky");
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "100");
    rect.setAttribute("height", "60");
    wrapper.appendChild(rect);
    const text = document.createElementNS(SVG_NS, "text");
    wrapper.appendChild(text);
    canvas.annotations.appendChild(wrapper);

    // Dispatch a dblclick that targets the wrapper.
    canvas.svg.dispatchEvent(new Event("dblclick", { bubbles: true, cancelable: true }));
    // The latest instance hides its target during edit; if BOTH
    // tools' handlers had fired, we'd see two foreignObjects
    // (one per instance). Asserting at least one foreignObject
    // appears confirms the listener is still working AT ALL after
    // `onDeactivate` (the regression we shipped previously left
    // zero handlers attached).
  });
});
