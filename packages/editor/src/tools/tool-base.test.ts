/**
 * @vitest-environment happy-dom
 *
 * `ToolBase` is the abstract base every concrete tool extends.
 * Two constructor forms (canvas-form for production via
 * `tool-factories.ts`, surface-form for unit tests via
 * `createMockToolSurface`), one shared `addAnnotation` /
 * `createSVG` surface, and the `surface` / `options` /
 * `canvas` / `history` protected fields. Tests pin both
 * constructor branches and the SVG-namespace creation helper.
 */

import { createMockToolSurface } from "@ingcreators/annot-core/editor/tool-lifecycle";
import type {
  ToolDOMSurface,
  MockToolSurface,
} from "@ingcreators/annot-core/editor/tool-lifecycle";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import { describe, expect, it, vi } from "vitest";
import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";
import { ToolBase } from "./tool-base.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const STUB_OPTIONS: ToolOptions = {
  strokeColor: "#000000",
  fillColor: "#ffffff",
  strokeWidth: 2,
  fontSize: 14,
  strokeDasharray: "",
  fillOpacity: 1,
};

/** Concrete subclass that exposes the protected surface so tests
 *  can drive both branches without importing every tool. */
class ProbeTool extends ToolBase {
  readonly name = "probe";
  onPointerDown(): void {}
  onPointerMove(): void {}
  onPointerUp(): void {}
  /** Re-expose protected fields for assertions. */
  getSurface(): ToolDOMSurface {
    return this.surface;
  }
  getOptions(): ToolOptions {
    return this.options;
  }
  getCanvas(): CanvasManager | undefined {
    return this.canvas;
  }
  getHistory(): History | undefined {
    return this.history;
  }
  /** Public proxy to the protected createSVG helper. */
  buildSvg<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string>,
  ): SVGElementTagNameMap[K] {
    return this.createSVG(tag, attrs);
  }
  /** Public proxy to addAnnotation (which delegates to the surface). */
  commit(el: SVGElement): void {
    this.addAnnotation(el);
  }
}

function makeMock(): MockToolSurface {
  const host = document.createElementNS(SVG_NS, "g") as SVGGElement;
  return createMockToolSurface(host);
}

describe("ToolBase — surface-form constructor (test path)", () => {
  it("stores the surface and options verbatim, leaves canvas/history undefined", () => {
    const surface = makeMock();
    const tool = new ProbeTool(surface, STUB_OPTIONS);
    expect(tool.getSurface()).toBe(surface);
    expect(tool.getOptions()).toBe(STUB_OPTIONS);
    expect(tool.getCanvas()).toBeUndefined();
    expect(tool.getHistory()).toBeUndefined();
  });

  it("addAnnotation delegates to surface.addAnnotation (mock records it as committed)", () => {
    const surface = makeMock();
    const tool = new ProbeTool(surface, STUB_OPTIONS);
    const el = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    tool.commit(el);
    expect(surface.committed).toEqual([el]);
    expect(surface.saveCount).toBe(1);
  });
});

describe("ToolBase — canvas-form constructor (production path)", () => {
  it("synthesises a surface from canvas + history; stores both as protected fields", () => {
    const annotations = document.createElementNS(SVG_NS, "g") as SVGGElement;
    const canvas = { annotations } as unknown as CanvasManager;
    const history = { save: vi.fn() } as unknown as History;
    const tool = new ProbeTool(canvas, history, STUB_OPTIONS);
    expect(tool.getCanvas()).toBe(canvas);
    expect(tool.getHistory()).toBe(history);
    expect(tool.getOptions()).toBe(STUB_OPTIONS);
    // The synthesised surface has the three required methods.
    const s = tool.getSurface();
    expect(typeof s.attachDraft).toBe("function");
    expect(typeof s.addAnnotation).toBe("function");
    expect(typeof s.saveHistory).toBe("function");
  });

  it("addAnnotation through the canvas-form surface mounts to canvas.annotations and saves", () => {
    const annotations = document.createElementNS(SVG_NS, "g") as SVGGElement;
    const canvas = { annotations } as unknown as CanvasManager;
    const save = vi.fn();
    const history = { save } as unknown as History;
    const tool = new ProbeTool(canvas, history, STUB_OPTIONS);
    const el = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    tool.commit(el);
    expect(annotations.children[0]).toBe(el);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("ToolBase.createSVG", () => {
  it("creates an element in the SVG namespace + applies every attr", () => {
    const tool = new ProbeTool(makeMock(), STUB_OPTIONS);
    const rect = tool.buildSvg("rect", {
      x: "10",
      y: "20",
      width: "100",
      height: "50",
      fill: "#ff0000",
    });
    expect(rect.namespaceURI).toBe(SVG_NS);
    expect(rect.tagName).toBe("rect");
    expect(rect.getAttribute("x")).toBe("10");
    expect(rect.getAttribute("y")).toBe("20");
    expect(rect.getAttribute("width")).toBe("100");
    expect(rect.getAttribute("height")).toBe("50");
    expect(rect.getAttribute("fill")).toBe("#ff0000");
  });

  it("supports any element of SVGElementTagNameMap (text, path, g)", () => {
    const tool = new ProbeTool(makeMock(), STUB_OPTIONS);
    expect(tool.buildSvg("text", {}).tagName).toBe("text");
    expect(tool.buildSvg("path", { d: "M0 0" }).getAttribute("d")).toBe("M0 0");
    expect(tool.buildSvg("g", {}).tagName).toBe("g");
  });

  it("empty attrs object → no attributes set", () => {
    const tool = new ProbeTool(makeMock(), STUB_OPTIONS);
    const g = tool.buildSvg("g", {});
    expect(g.attributes.length).toBe(0);
  });
});

describe("ToolBase optional lifecycle hooks", () => {
  it("subclasses without onActivate / onDeactivate / onKeyDown / onShapeComplete don't crash", () => {
    const tool = new ProbeTool(makeMock(), STUB_OPTIONS);
    expect(tool.onActivate).toBeUndefined();
    expect(tool.onDeactivate).toBeUndefined();
    expect(tool.onKeyDown).toBeUndefined();
    expect(tool.onShapeComplete).toBeUndefined();
  });
});
