// Tests for the DSL → SVG converter. Snapshot-style assertions
// pin the exact SVG output per annotation type so a refactor that
// changes whitespace or attribute order fails intentionally — the
// public contract is the rendered SVG, not the source code shape.

import { describe, expect, test } from "vitest";

import { bboxAnnotationsToSvg } from "./to-svg.js";
import type { BboxAnnotation } from "./types.js";

describe("bboxAnnotationsToSvg", () => {
  test("rect with default error intent", () => {
    const out = bboxAnnotationsToSvg([
      { type: "rect", bbox: { x: 10, y: 20, width: 100, height: 50 } },
    ]);
    expect(out).toBe(
      `<rect x="10" y="20" width="100" height="50" fill="none" stroke="#ef4444" stroke-width="2"/>`,
    );
  });

  test("rect with explicit warning intent + custom stroke width", () => {
    const out = bboxAnnotationsToSvg([
      {
        type: "rect",
        bbox: { x: 0, y: 0, width: 10, height: 10 },
        intent: "warning",
        strokeWidth: 4,
      },
    ]);
    expect(out).toBe(
      `<rect x="0" y="0" width="10" height="10" fill="none" stroke="#f59e0b" stroke-width="4"/>`,
    );
  });

  test("rect with explicit stroke override beats intent", () => {
    const out = bboxAnnotationsToSvg([
      {
        type: "rect",
        bbox: { x: 0, y: 0, width: 10, height: 10 },
        intent: "error",
        stroke: "purple",
      },
    ]);
    expect(out).toBe(
      `<rect x="0" y="0" width="10" height="10" fill="none" stroke="purple" stroke-width="2"/>`,
    );
  });

  test("circle with success intent", () => {
    const out = bboxAnnotationsToSvg([
      {
        type: "circle",
        center: { x: 50, y: 60 },
        radius: 15,
        intent: "success",
      },
    ]);
    expect(out).toBe(
      `<circle cx="50" cy="60" r="15" fill="none" stroke="#10b981" stroke-width="2"/>`,
    );
  });

  test("arrow emits a self-contained marker definition", () => {
    const out = bboxAnnotationsToSvg([
      {
        type: "arrow",
        from: { x: 100, y: 100 },
        to: { x: 200, y: 150 },
        intent: "info",
      },
    ]);
    // Marker id is suffixed by a counter — assert on the structure
    // instead of an exact id so re-orderings don't break the test.
    expect(out).toMatch(
      /^<defs><marker id="annot-arrow-\d+" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6"\/><\/marker><\/defs><line x1="100" y1="100" x2="200" y2="150" stroke="#3b82f6" stroke-width="2" marker-end="url\(#annot-arrow-\d+\)"\/>$/,
    );
  });

  test("text uses intent-derived colour token", () => {
    const out = bboxAnnotationsToSvg([
      {
        type: "text",
        at: { x: 10, y: 30 },
        content: "missing validation",
        intent: "error",
      },
    ]);
    expect(out).toBe(
      `<text x="10" y="30" fill="#991b1b" font-size="14" text-anchor="start">missing validation</text>`,
    );
  });

  test("text escapes special characters", () => {
    const out = bboxAnnotationsToSvg([
      {
        type: "text",
        at: { x: 0, y: 0 },
        content: "<script>alert(1)</script>",
      },
    ]);
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
  });

  test("callout composes rect + arrow + text", () => {
    const out = bboxAnnotationsToSvg([
      {
        type: "callout",
        at: { x: 50, y: 50 },
        targetBbox: { x: 200, y: 200, width: 80, height: 40 },
        content: "form validation broken",
        intent: "error",
      },
    ]);
    expect(out).toMatch(/<rect /);
    expect(out).toMatch(/<defs><marker /);
    expect(out).toMatch(/<text [^>]*>form validation broken<\/text>/);
    expect(out.indexOf("<rect")).toBeLessThan(out.indexOf("<defs>"));
    expect(out.indexOf("<defs>")).toBeLessThan(out.indexOf("<text"));
  });

  test("callout arrow lands on the nearest target edge", () => {
    const out = bboxAnnotationsToSvg([
      {
        type: "callout",
        at: { x: 50, y: 50 },
        targetBbox: { x: 200, y: 200, width: 80, height: 40 },
        content: "x",
      },
    ]);
    expect(out).toMatch(/<line x1="50" y1="50" x2="200" y2="200"/);
  });

  test("raw fragment passes through verbatim", () => {
    const out = bboxAnnotationsToSvg([
      {
        type: "raw",
        svgFragment: `<g class="custom"><circle cx="0" cy="0" r="5"/></g>`,
      },
    ]);
    expect(out).toBe(`<g class="custom"><circle cx="0" cy="0" r="5"/></g>`);
  });

  test("multiple annotations concatenate in order", () => {
    const annotations: BboxAnnotation[] = [
      { type: "rect", bbox: { x: 0, y: 0, width: 5, height: 5 } },
      { type: "text", at: { x: 10, y: 10 }, content: "label" },
    ];
    const out = bboxAnnotationsToSvg(annotations);
    expect(out.indexOf("<rect")).toBeLessThan(out.indexOf("<text"));
  });

  test("default intent is error when no intent is set", () => {
    const out = bboxAnnotationsToSvg([{ type: "rect", bbox: { x: 0, y: 0, width: 1, height: 1 } }]);
    expect(out).toContain(`stroke="#ef4444"`);
  });

  test("empty annotation list produces empty string", () => {
    expect(bboxAnnotationsToSvg([])).toBe("");
  });
});
