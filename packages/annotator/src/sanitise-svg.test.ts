import { describe, expect, it } from "vitest";
import { sanitiseAnnotationsSvg } from "./sanitise-svg.js";

const SVG_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">`;
const SVG_CLOSE = "</svg>";

describe("sanitiseAnnotationsSvg", () => {
  it("returns empty string for empty input", () => {
    expect(sanitiseAnnotationsSvg("")).toBe("");
    expect(sanitiseAnnotationsSvg("   \n  ")).toBe("");
  });

  it("returns empty string for malformed input", () => {
    // xmldom returns null documentElement on hard failure — guard.
    expect(sanitiseAnnotationsSvg("not actually svg")).toBe("");
  });

  it("passes annotation children through unchanged", () => {
    const inner =
      `<rect x="10" y="10" width="80" height="80" stroke="red"/>` +
      `<line x1="0" y1="0" x2="100" y2="100" stroke="blue"/>`;
    const result = sanitiseAnnotationsSvg(SVG_OPEN + inner + SVG_CLOSE);
    expect(result).toContain("<rect");
    expect(result).toContain("<line");
    expect(result).toContain(`stroke="red"`);
    expect(result).toContain(`stroke="blue"`);
  });

  it("strips the base-image direct-child of the root svg", () => {
    const annotations =
      `<image href="data:image/png;base64,AAA" width="100" height="100"/>` +
      `<rect x="0" y="0" width="50" height="50" fill="red"/>`;
    const result = sanitiseAnnotationsSvg(SVG_OPEN + annotations + SVG_CLOSE);
    expect(result).not.toContain("<image");
    expect(result).toContain("<rect");
  });

  it("keeps redact <image> elements (data-redact-style attr)", () => {
    const annotations =
      `<image href="data:image/png;base64,AAA" width="100" height="100"/>` +
      `<image data-redact-style="mosaic" href="data:image/png;base64,BBB" ` +
      `width="50" height="50"/>`;
    const result = sanitiseAnnotationsSvg(SVG_OPEN + annotations + SVG_CLOSE);
    // First (base) image removed
    expect(result).not.toContain('href="data:image/png;base64,AAA"');
    // Redact image preserved
    expect(result).toContain('data-redact-style="mosaic"');
    expect(result).toContain('href="data:image/png;base64,BBB"');
  });

  it("strips <g id='ui-overlay'>", () => {
    const annotations =
      `<g id="ui-overlay"><circle cx="0" cy="0" r="5"/></g>` +
      `<rect x="0" y="0" width="10" height="10"/>`;
    const result = sanitiseAnnotationsSvg(SVG_OPEN + annotations + SVG_CLOSE);
    expect(result).not.toContain("ui-overlay");
    expect(result).not.toContain("<circle");
    expect(result).toContain("<rect");
  });

  it("unwraps <g id='annotations'> — children promoted to top level", () => {
    const annotations =
      `<g id="annotations">` +
      `<rect x="0" y="0" width="10" height="10" fill="red"/>` +
      `<line x1="0" y1="0" x2="10" y2="10" stroke="blue"/>` +
      "</g>";
    const result = sanitiseAnnotationsSvg(SVG_OPEN + annotations + SVG_CLOSE);
    expect(result).not.toContain("<g");
    expect(result).toContain("<rect");
    expect(result).toContain("<line");
  });

  it("strips <style data-annot-fonts> from defs but keeps defs", () => {
    const annotations =
      "<defs>" +
      `<style data-annot-fonts="true">@font-face { ... }</style>` +
      `<linearGradient id="grad-1"><stop offset="0%"/></linearGradient>` +
      "</defs>" +
      `<rect fill="url(#grad-1)" x="0" y="0" width="10" height="10"/>`;
    const result = sanitiseAnnotationsSvg(SVG_OPEN + annotations + SVG_CLOSE);
    expect(result).toContain("<defs");
    expect(result).toContain("linearGradient");
    expect(result).toContain('id="grad-1"');
    expect(result).not.toContain("data-annot-fonts");
    expect(result).not.toContain("@font-face");
  });

  it("drops defs entirely when only its annot-fonts <style> remained", () => {
    const annotations =
      "<defs>" +
      `<style data-annot-fonts="true">@font-face { ... }</style>` +
      "</defs>" +
      `<rect x="0" y="0" width="10" height="10"/>`;
    const result = sanitiseAnnotationsSvg(SVG_OPEN + annotations + SVG_CLOSE);
    expect(result).not.toContain("<defs");
    expect(result).not.toContain("data-annot-fonts");
    expect(result).toContain("<rect");
  });

  it("handles realistic editor-saved output (defs + annotations group)", () => {
    // What `exportAnnotationsSvgForIdb` produces today, plus a
    // `<style data-annot-fonts>` left in defs that the editor
    // adds for self-contained SVG export.
    const annotations =
      "<defs>" +
      `<style data-annot-fonts="true">.annot{}</style>` +
      `<marker id="arrow-1" viewBox="0 0 10 10" refX="5" refY="5" ` +
      `markerWidth="6" markerHeight="6" orient="auto">` +
      `<path d="M0 0 L10 5 L0 10 Z" fill="black"/>` +
      "</marker>" +
      "</defs>" +
      `<rect x="10" y="10" width="80" height="80" fill="none" stroke="red"/>` +
      `<line x1="20" y1="20" x2="80" y2="80" stroke="black" ` +
      `marker-end="url(#arrow-1)"/>`;
    const result = sanitiseAnnotationsSvg(SVG_OPEN + annotations + SVG_CLOSE);
    expect(result).toContain("<defs");
    expect(result).toContain('id="arrow-1"');
    expect(result).not.toContain("data-annot-fonts");
    expect(result).not.toContain(".annot{}");
    expect(result).toContain("<rect");
    expect(result).toContain("<line");
    expect(result).toContain("marker-end=");
  });
});
