// @vitest-environment happy-dom
//
// `decomposeBlockSvg` tests — Phase 2 of
// `card-document-image-gallery-link-sync.md`. Verifies the doc
// image-block SVG → `ImageRecord`-shape decomposition that drives
// the doc → gallery push path.

import { describe, expect, it } from "vitest";
import { decomposeBlockSvg } from "./decompose-block-svg.js";

const PNG_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("decomposeBlockSvg", () => {
  it("extracts the base bitmap data URL from <image href>", () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">` +
      `<image href="${PNG_PIXEL}" width="100" height="50"/>` +
      `<g id="annotations"></g>` +
      "</svg>";
    const parts = decomposeBlockSvg(svg);
    expect(parts.originalDataUrl).toBe(PNG_PIXEL);
    expect(parts.width).toBe(100);
    expect(parts.height).toBe(50);
  });

  it("falls back to viewBox dimensions when <image> width / height are missing", () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">` +
      `<image href="${PNG_PIXEL}"/>` +
      "</svg>";
    const parts = decomposeBlockSvg(svg);
    expect(parts.width).toBe(320);
    expect(parts.height).toBe(240);
  });

  it("produces an empty-but-flat annotationsSvg when the block has no annotations", () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">` +
      `<image href="${PNG_PIXEL}" width="100" height="50"/>` +
      `<g id="annotations"></g>` +
      "</svg>";
    const parts = decomposeBlockSvg(svg);
    // Either `<svg ... />` (self-closing) or `<svg ...></svg>` —
    // happy-dom emits the self-closing form when childless; either
    // round-trips identically through gallery storage.
    expect(parts.annotationsSvg).toMatch(/^<svg\b[^>]*(\/>|><\/svg>)$/);
    expect(parts.annotationsSvg).toContain('width="100"');
    expect(parts.annotationsSvg).toContain('height="50"');
    // The base image is stripped.
    expect(parts.annotationsSvg).not.toContain("<image");
  });

  it('flattens <g id="annotations"> children into the root', () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">` +
      `<image href="${PNG_PIXEL}" width="100" height="50"/>` +
      `<g id="annotations">` +
      `<rect data-type="rect" x="10" y="10" width="20" height="15"/>` +
      `<text data-type="text" x="30" y="40">hi</text>` +
      "</g>" +
      "</svg>";
    const parts = decomposeBlockSvg(svg);
    expect(parts.annotationsSvg).toContain('data-type="rect"');
    expect(parts.annotationsSvg).toContain('data-type="text"');
    expect(parts.annotationsSvg).not.toContain('id="annotations"');
    // Children land at the top level (no wrapper <g>).
    expect(parts.annotationsSvg).toMatch(/<svg[^>]*>\s*<rect/);
  });

  it("preserves redact-style <image> overlays (they are annotations)", () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">` +
      `<image href="${PNG_PIXEL}" width="100" height="50"/>` +
      `<g id="annotations">` +
      `<image data-redact-style="mosaic" href="data:image/png;base64,MOSAIC" x="5" y="5" width="20" height="10"/>` +
      "</g>" +
      "</svg>";
    const parts = decomposeBlockSvg(svg);
    // Base image is removed, redact overlay survives.
    expect(parts.annotationsSvg).toContain("MOSAIC");
    expect(parts.annotationsSvg).toContain('data-redact-style="mosaic"');
    expect(parts.annotationsSvg).not.toContain(PNG_PIXEL);
  });

  it('handles the flat-annotations form (no <g id="annotations"> wrapper)', () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">` +
      `<image href="${PNG_PIXEL}" width="100" height="50"/>` +
      `<rect data-type="rect" x="10" y="10" width="20" height="15"/>` +
      "</svg>";
    const parts = decomposeBlockSvg(svg);
    expect(parts.annotationsSvg).toContain('data-type="rect"');
    expect(parts.annotationsSvg).not.toContain("<image");
  });

  it("returns empty parts for an empty input string", () => {
    const parts = decomposeBlockSvg("");
    expect(parts).toEqual({
      originalDataUrl: "",
      annotationsSvg: "",
      width: 0,
      height: 0,
    });
  });

  it("returns empty parts for unparseable input", () => {
    const parts = decomposeBlockSvg("<<<not xml");
    expect(parts.originalDataUrl).toBe("");
    expect(parts.annotationsSvg).toBe("");
  });

  it("drops a stray #ui-overlay element from the annotation fragment", () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">` +
      `<image href="${PNG_PIXEL}" width="100" height="50"/>` +
      `<rect data-type="rect" x="10" y="10" width="20" height="15"/>` +
      `<g id="ui-overlay"><circle cx="0" cy="0" r="5"/></g>` +
      "</svg>";
    const parts = decomposeBlockSvg(svg);
    expect(parts.annotationsSvg).toContain('data-type="rect"');
    expect(parts.annotationsSvg).not.toContain('id="ui-overlay"');
  });
});
