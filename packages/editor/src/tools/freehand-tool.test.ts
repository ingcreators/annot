/**
 * @vitest-environment happy-dom
 *
 * FreehandTool driven against a mock surface. The freehand tool's
 * session model (multi-stroke `<g data-type="freehand">` wrapper)
 * is the most state-heavy lifecycle in the editor; pinning it in
 * a unit test guards against regressions like "Esc fails to commit
 * the session" or "second stroke creates a second wrapper group".
 */

import { createMockToolSurface } from "@ingcreators/annot-core/editor/tool-lifecycle";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import { describe, expect, it } from "vitest";
import { FreehandTool } from "./freehand-tool.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeOptions(overrides: Partial<ToolOptions> = {}): ToolOptions {
  return {
    strokeColor: "#000000",
    fillColor: "#ffffff",
    strokeWidth: 2,
    fontSize: 16,
    strokeDasharray: "",
    fillOpacity: 1,
    drawStyle: "pen",
    ...overrides,
  };
}

const evt = (): PointerEvent => new PointerEvent("pointerdown", { bubbles: true });
const pt = (x: number, y: number): DOMPoint => new DOMPoint(x, y);
const host = (): SVGGElement => document.createElementNS(SVG_NS, "g");

describe("FreehandTool — single-stroke session", () => {
  it("attaches the session group on first pen-down", () => {
    const h = host();
    const surface = createMockToolSurface(h);
    const tool = new FreehandTool(surface, makeOptions());

    tool.onPointerDown(evt(), pt(10, 10));
    expect(surface.drafts).toHaveLength(1);
    expect(surface.drafts[0]!.tagName.toLowerCase()).toBe("g");
    expect(surface.drafts[0]!.getAttribute("data-type")).toBe("freehand");
  });

  it("does NOT save history mid-stroke", () => {
    const h = host();
    const surface = createMockToolSurface(h);
    const tool = new FreehandTool(surface, makeOptions());

    tool.onPointerDown(evt(), pt(10, 10));
    tool.onPointerMove(evt(), pt(20, 15));
    tool.onPointerMove(evt(), pt(30, 25));
    tool.onPointerUp(evt(), pt(30, 25));
    expect(surface.saveCount).toBe(0);
  });

  it("commits one history snapshot when endSession is called", () => {
    const h = host();
    const surface = createMockToolSurface(h);
    const tool = new FreehandTool(surface, makeOptions());

    tool.onPointerDown(evt(), pt(10, 10));
    tool.onPointerMove(evt(), pt(20, 15));
    tool.onPointerMove(evt(), pt(30, 25));
    tool.onPointerUp(evt(), pt(30, 25));
    tool.endSession();
    expect(surface.saveCount).toBe(1);
  });
});

describe("FreehandTool — multi-stroke session", () => {
  it("reuses the same session group across pen-down events", () => {
    const h = host();
    const surface = createMockToolSurface(h);
    const tool = new FreehandTool(surface, makeOptions());

    tool.onPointerDown(evt(), pt(0, 0));
    tool.onPointerMove(evt(), pt(10, 0));
    tool.onPointerMove(evt(), pt(20, 0));
    tool.onPointerUp(evt(), pt(20, 0));

    tool.onPointerDown(evt(), pt(50, 50));
    tool.onPointerMove(evt(), pt(60, 50));
    tool.onPointerMove(evt(), pt(70, 50));
    tool.onPointerUp(evt(), pt(70, 50));

    // Single attach across the entire session.
    expect(surface.drafts).toHaveLength(1);
    // Two `<path>` strokes inside that group.
    const group = surface.drafts[0]!;
    expect(group.querySelectorAll("path").length).toBe(2);
  });

  it("endSession after multiple strokes saves history exactly once", () => {
    const h = host();
    const surface = createMockToolSurface(h);
    const tool = new FreehandTool(surface, makeOptions());

    for (let stroke = 0; stroke < 3; stroke++) {
      tool.onPointerDown(evt(), pt(stroke * 30, 0));
      tool.onPointerMove(evt(), pt(stroke * 30 + 10, 0));
      tool.onPointerMove(evt(), pt(stroke * 30 + 20, 0));
      tool.onPointerUp(evt(), pt(stroke * 30 + 20, 0));
    }
    tool.endSession();
    expect(surface.saveCount).toBe(1);
  });
});

describe("FreehandTool — empty / cancelled sessions", () => {
  it("endSession with no strokes drops the empty wrapper without saving history", () => {
    const h = host();
    const surface = createMockToolSurface(h);
    const tool = new FreehandTool(surface, makeOptions());

    // No pen-down at all — endSession should be a no-op.
    tool.endSession();
    expect(surface.saveCount).toBe(0);
    expect(surface.drafts).toHaveLength(0);
  });

  it("Escape during a session ends the session gracefully", () => {
    const h = host();
    const surface = createMockToolSurface(h);
    const tool = new FreehandTool(surface, makeOptions());

    tool.onPointerDown(evt(), pt(0, 0));
    tool.onPointerMove(evt(), pt(10, 0));
    tool.onPointerMove(evt(), pt(20, 0));
    tool.onPointerUp(evt(), pt(20, 0));
    tool.onKeyDown!(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(surface.saveCount).toBe(1);
  });
});
