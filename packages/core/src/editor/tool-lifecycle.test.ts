// @vitest-environment happy-dom
//
// `createMockToolSurface` is the test seam Proposal 3 promotes: it
// records every surface call AND mounts the element into a host so
// tools can keep mutating attributes during a drag. These tests pin
// the recording + mounting contract so any change to the mock's
// behaviour fails loudly.

import { describe, expect, it } from "vitest";
import { createMockToolSurface } from "./tool-lifecycle.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgGroup(): SVGGElement {
  return document.createElementNS(SVG_NS, "g");
}

function svgRect(): SVGRectElement {
  return document.createElementNS(SVG_NS, "rect");
}

describe("createMockToolSurface", () => {
  it("starts with empty draft / committed lists and zero saveCount", () => {
    const host = svgGroup();
    const surface = createMockToolSurface(host);
    expect(surface.drafts).toEqual([]);
    expect(surface.committed).toEqual([]);
    expect(surface.saveCount).toBe(0);
  });

  it("attachDraft mounts the element into host AND records it without bumping saveCount", () => {
    const host = svgGroup();
    const surface = createMockToolSurface(host);
    const el = svgRect();
    surface.attachDraft(el);
    expect(surface.drafts).toEqual([el]);
    expect(surface.committed).toEqual([]);
    expect(surface.saveCount).toBe(0);
    expect(host.contains(el)).toBe(true);
  });

  it("addAnnotation mounts AND bumps saveCount AND records under committed", () => {
    const host = svgGroup();
    const surface = createMockToolSurface(host);
    const el = svgRect();
    surface.addAnnotation(el);
    expect(surface.committed).toEqual([el]);
    expect(surface.drafts).toEqual([]);
    expect(surface.saveCount).toBe(1);
    expect(host.contains(el)).toBe(true);
  });

  it("saveHistory bumps saveCount without touching host or buffers", () => {
    const host = svgGroup();
    const surface = createMockToolSurface(host);
    surface.saveHistory();
    expect(surface.saveCount).toBe(1);
    expect(host.children).toHaveLength(0);
    expect(surface.drafts).toEqual([]);
    expect(surface.committed).toEqual([]);
  });

  it("preserves the live element so subsequent attribute mutations apply", () => {
    // The whole reason the mock attaches the element to a host: a
    // tool's pointermove handler mutates the element's attributes
    // through the same node reference it received in pointerdown.
    const host = svgGroup();
    const surface = createMockToolSurface(host);
    const el = svgRect();
    surface.attachDraft(el);
    el.setAttribute("width", "50");
    el.setAttribute("height", "30");
    expect(host.firstElementChild).toBe(el);
    expect(el.getAttribute("width")).toBe("50");
    expect(el.getAttribute("height")).toBe("30");
  });

  it("records each attach in order so tests can assert multi-element gestures", () => {
    const host = svgGroup();
    const surface = createMockToolSurface(host);
    const a = svgRect();
    const b = svgRect();
    surface.attachDraft(a);
    surface.attachDraft(b);
    expect(surface.drafts).toEqual([a, b]);
  });
});
