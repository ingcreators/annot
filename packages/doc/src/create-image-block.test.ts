/**
 * Tests for `createImageBlockFromDataUrl` — pure-Node tests for
 * the Phase 5b helper that wraps a bitmap into the canonical
 * `ImageBlock` SVG.
 */

import { describe, expect, it } from "vitest";
import { createImageBlockFromDataUrl } from "./create-image-block.js";

const PNG_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("createImageBlockFromDataUrl", () => {
  it("synthesises an ImageBlock with canonical SVG shape", () => {
    const block = createImageBlockFromDataUrl(PNG_PIXEL, 200, 150);
    expect(block.kind).toBe("image");
    expect(block.id).toMatch(/^img-/);
    expect(block.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(block.svg).toContain('data-annot-version="1"');
    expect(block.svg).toContain('viewBox="0 0 200 150"');
    expect(block.svg).toContain('width="200"');
    expect(block.svg).toContain('height="150"');
    expect(block.svg).toContain('<image href="data:image/png;base64,');
    expect(block.svg).toContain('<g id="annotations"></g>');
    expect(block.caption).toBeUndefined();
  });

  it("rounds non-integer dimensions", () => {
    const block = createImageBlockFromDataUrl(PNG_PIXEL, 200.7, 150.2);
    expect(block.svg).toContain('viewBox="0 0 201 150"');
  });

  it("respects an explicit id and caption", () => {
    const block = createImageBlockFromDataUrl(PNG_PIXEL, 100, 100, {
      id: "img-custom-1",
      caption: "Sample caption",
    });
    expect(block.id).toBe("img-custom-1");
    expect(block.caption).toBe("Sample caption");
  });

  it("escapes ampersand / quote characters inside the data URL value", () => {
    const url = 'data:image/svg+xml,<svg>&"</svg>';
    const block = createImageBlockFromDataUrl(url, 50, 50);
    expect(block.svg).toContain("&amp;&quot;&lt;");
    expect(block.svg).not.toContain('"<svg>&"');
  });

  it("rejects non-positive dimensions", () => {
    expect(() => createImageBlockFromDataUrl(PNG_PIXEL, 0, 100)).toThrow(/invalid width/);
    expect(() => createImageBlockFromDataUrl(PNG_PIXEL, 100, 0)).toThrow(/invalid height/);
    expect(() => createImageBlockFromDataUrl(PNG_PIXEL, Number.NaN, 100)).toThrow(/invalid width/);
    expect(() => createImageBlockFromDataUrl(PNG_PIXEL, 100, -50)).toThrow(/invalid height/);
  });
});
