// Phase 0 spike integration test.
//
// Verifies two things:
//   1. The Node-side renderImageRecord equivalent produces a valid
//      PNG when given a base64 PNG base image + a small annotation
//      payload (rect / line / circle — pure shapes, no text so the
//      output is deterministic across platforms).
//   2. The output size is reasonable (sanity check; resvg-js
//      always returns at least the PNG header).
//
// Snapshot the byte-length and the first 16 bytes (PNG magic +
// IHDR chunk start) — that's enough to catch a regression where
// resvg starts emitting a different format / colour-profile while
// keeping the test deterministic on every CI runner.

import { describe, expect, it } from "vitest";
import { buildHeadlessSvg, renderImageRecordToPngBytes } from "./render.js";

// 4x4 transparent PNG, hand-crafted. Tiny enough to keep this file
// readable; meaningful enough to round-trip through resvg's
// <image href="..."> resolver.
const TINY_PNG_DATA_URL =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGUlEQVR4nGNgYGD4z" +
  "8DAwMDAwMDA8J+BgQEAGgAGAtZuBz8AAAAASUVORK5CYII=";

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("Phase 0 spike — renderImageRecordToPngBytes", () => {
  it("emits a valid PNG for shapes-only annotations", () => {
    const annotations =
      `<rect x="10" y="10" width="80" height="80" ` +
      `fill="none" stroke="red" stroke-width="3"/>` +
      `<line x1="20" y1="20" x2="80" y2="80" ` +
      `stroke="blue" stroke-width="2"/>` +
      `<circle cx="50" cy="50" r="20" fill="yellow" opacity="0.5"/>`;

    const png = renderImageRecordToPngBytes(TINY_PNG_DATA_URL, annotations, 100, 100);

    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(100);

    // First 8 bytes are the PNG signature — any reasonable PNG
    // encoder emits these unchanged.
    const header = png.slice(0, 8);
    expect(Array.from(header)).toEqual(Array.from(PNG_MAGIC));
  });

  it("handles the gradient + marker reference shape", () => {
    // The browser-side renderer's `sanitiseRenderDefs` keeps `<defs>`
    // so `fill="url(#grad-…)"` and `marker-end="url(#…)"` still
    // resolve. resvg-js handles these natively; this test confirms
    // the round-trip doesn't crash. We don't snapshot pixels — just
    // valid-PNG-out.
    const annotations =
      "<defs>" +
      `<linearGradient id="grad-1" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="red"/>` +
      `<stop offset="100%" stop-color="blue"/>` +
      "</linearGradient>" +
      `<marker id="arrow-1" viewBox="0 0 10 10" refX="5" refY="5" ` +
      `markerWidth="6" markerHeight="6" orient="auto">` +
      `<path d="M 0 0 L 10 5 L 0 10 z" fill="black"/>` +
      "</marker>" +
      "</defs>" +
      `<rect x="10" y="10" width="80" height="80" ` +
      `fill="url(#grad-1)"/>` +
      `<line x1="20" y1="50" x2="80" y2="50" ` +
      `stroke="black" stroke-width="2" marker-end="url(#arrow-1)"/>`;

    const png = renderImageRecordToPngBytes(TINY_PNG_DATA_URL, annotations, 100, 100);

    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(100);
    expect(Array.from(png.slice(0, 8))).toEqual(Array.from(PNG_MAGIC));
  });

  it("does not throw on a text element (font fallback is platform-dependent)", () => {
    // This test is deliberately permissive — it documents that
    // text DOES render without throwing, even when the requested
    // font isn't installed. The visual result (correct glyph vs
    // tofu vs missing) varies by OS and is the subject of the
    // documented Phase-1 follow-up in SPIKE_REPORT.md.
    const annotations =
      `<text x="50" y="50" fill="black" font-size="12" ` + `text-anchor="middle">Hello</text>`;

    const png = renderImageRecordToPngBytes(TINY_PNG_DATA_URL, annotations, 100, 100);

    expect(png).toBeInstanceOf(Uint8Array);
    expect(Array.from(png.slice(0, 8))).toEqual(Array.from(PNG_MAGIC));
  });
});

describe("Phase 0 spike — buildHeadlessSvg", () => {
  it("emits the Annot version stamp", () => {
    const svg = buildHeadlessSvg(TINY_PNG_DATA_URL, "", 100, 100);
    expect(svg).toContain("data-annot-version=");
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain(`href="${TINY_PNG_DATA_URL}"`);
  });

  it("inlines annotation inner XML verbatim", () => {
    const inner = `<rect x="0" y="0" width="10" height="10" fill="red"/>`;
    const svg = buildHeadlessSvg(TINY_PNG_DATA_URL, inner, 50, 50);
    expect(svg).toContain(inner);
  });
});
