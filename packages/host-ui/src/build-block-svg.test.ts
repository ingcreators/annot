// @vitest-environment happy-dom
//
// `buildBlockSvg` tests — Phase 3 of
// `card-document-image-gallery-link-sync.md`. Verifies that the
// gallery → doc-block SVG re-composition produces stable bytes
// and matches the shape `createCardDocumentFromImages` /
// `createImageBlockFromDataUrl` emit.

import { describe, expect, it } from "vitest";
import { annotationChildrenEqual, buildBlockSvg } from "./build-block-svg.js";
import { decomposeBlockSvg } from "./decompose-block-svg.js";

const PNG_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("buildBlockSvg", () => {
  it("emits the canonical inline-form doc-block SVG", () => {
    const svg = buildBlockSvg({
      originalDataUrl: PNG_PIXEL,
      annotationsSvg: "",
      width: 100,
      height: 50,
    });
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('data-annot-version="1"');
    expect(svg).toContain('viewBox="0 0 100 50"');
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="50"');
    expect(svg).toContain(`<image href="${PNG_PIXEL}" width="100" height="50"/>`);
    expect(svg).toContain('<g id="annotations"></g>');
  });

  it("extracts annotation children from a full <svg> annotationsSvg", () => {
    const annotationsSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">` +
      `<rect data-type="rect" x="10" y="10" width="20" height="15"/>` +
      `<text data-type="text" x="30" y="40">hi</text>` +
      "</svg>";
    const svg = buildBlockSvg({
      originalDataUrl: PNG_PIXEL,
      annotationsSvg,
      width: 100,
      height: 50,
    });
    expect(svg).toContain('<g id="annotations">');
    expect(svg).toContain('data-type="rect"');
    expect(svg).toContain('data-type="text"');
    // The OUTER svg is the doc-block one — no nested `<svg>` from
    // the annotationsSvg input.
    expect(svg.match(/<svg/g)?.length).toBe(1);
  });

  it("preserves redact-style overlays", () => {
    const annotationsSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">` +
      `<image data-redact-style="mosaic" href="data:image/png;base64,MOSAIC" x="5" y="5" width="20" height="10"/>` +
      "</svg>";
    const svg = buildBlockSvg({
      originalDataUrl: PNG_PIXEL,
      annotationsSvg,
      width: 100,
      height: 50,
    });
    expect(svg).toContain('data-redact-style="mosaic"');
    expect(svg).toContain("MOSAIC");
  });

  it("escapes ampersand / quote / angle in the base data URL attribute", () => {
    const evilUrl = 'data:image/svg+xml,<svg>&"</svg>';
    const svg = buildBlockSvg({
      originalDataUrl: evilUrl,
      annotationsSvg: "",
      width: 50,
      height: 50,
    });
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&quot;");
    expect(svg).toContain("&lt;");
    expect(svg).not.toContain('href="data:image/svg+xml,<svg>');
  });

  it("clamps zero / negative dimensions to 1", () => {
    const svg = buildBlockSvg({
      originalDataUrl: PNG_PIXEL,
      annotationsSvg: "",
      width: 0,
      height: -10,
    });
    expect(svg).toContain('viewBox="0 0 1 1"');
  });

  it("rounds fractional dimensions", () => {
    const svg = buildBlockSvg({
      originalDataUrl: PNG_PIXEL,
      annotationsSvg: "",
      width: 100.4,
      height: 50.7,
    });
    expect(svg).toContain('viewBox="0 0 100 51"');
  });

  // Pull-pass stability: `annotationChildrenEqual` must return
  // true after `decompose → build → decompose`, even though the
  // raw bytes differ between iterations (XMLSerializer adds
  // redundant xmlns; the outer svg may gain `data-annot-version`).
  // This is the load-bearing property the Phase 3 pull pass
  // relies on — once a pull lands and rewrites `block.svg`, the
  // NEXT pull's comparison must return "in sync" so we don't flap.
  it("preserves annotation children semantic-equality across decompose → build → decompose", () => {
    const sourceBlockSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 200 100" width="200" height="100">` +
      `<image href="${PNG_PIXEL}" width="200" height="100"/>` +
      `<rect data-type="rect" x="10" y="10" width="20" height="15"/>` +
      `<text data-type="text" x="30" y="40">hi</text>` +
      "</svg>";
    const firstDecompose = decomposeBlockSvg(sourceBlockSvg);
    const rebuilt = buildBlockSvg({
      originalDataUrl: firstDecompose.originalDataUrl,
      annotationsSvg: firstDecompose.annotationsSvg,
      width: firstDecompose.width,
      height: firstDecompose.height,
    });
    const secondDecompose = decomposeBlockSvg(rebuilt);
    expect(secondDecompose.originalDataUrl).toBe(firstDecompose.originalDataUrl);
    expect(secondDecompose.width).toBe(firstDecompose.width);
    expect(secondDecompose.height).toBe(firstDecompose.height);
    expect(
      annotationChildrenEqual(secondDecompose.annotationsSvg, firstDecompose.annotationsSvg),
    ).toBe(true);
  });
});

describe("annotationChildrenEqual", () => {
  it("ignores xmlns proliferation on migrated children", () => {
    const a = '<svg xmlns="http://www.w3.org/2000/svg"><rect data-type="rect" x="10"/></svg>';
    const b =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect xmlns="http://www.w3.org/2000/svg" data-type="rect" x="10"/></svg>';
    expect(annotationChildrenEqual(a, b)).toBe(true);
  });

  it("ignores the outer svg's data-annot-version attribute", () => {
    const a = '<svg xmlns="http://www.w3.org/2000/svg"><rect data-type="rect"/></svg>';
    const b =
      '<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1"><rect data-type="rect"/></svg>';
    expect(annotationChildrenEqual(a, b)).toBe(true);
  });

  it("returns false when the children differ", () => {
    const a = '<svg xmlns="http://www.w3.org/2000/svg"><rect data-type="rect" x="10"/></svg>';
    const b = '<svg xmlns="http://www.w3.org/2000/svg"><rect data-type="rect" x="20"/></svg>';
    expect(annotationChildrenEqual(a, b)).toBe(false);
  });

  it("returns true for two empty annotation fragments", () => {
    expect(annotationChildrenEqual("", "")).toBe(true);
    expect(
      annotationChildrenEqual(
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"/>',
      ),
    ).toBe(true);
  });

  it("returns false when one side has annotations and the other does not", () => {
    const empty = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const populated = '<svg xmlns="http://www.w3.org/2000/svg"><rect data-type="rect"/></svg>';
    expect(annotationChildrenEqual(empty, populated)).toBe(false);
  });
});
