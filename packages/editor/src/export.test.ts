/**
 * @vitest-environment happy-dom
 *
 * Coverage for the SVG export entry points in `export.ts`. The
 * primary contract pinned here is **id stripping** on the cloned
 * root: the editor's live canvas typically carries
 * `id="svg-root"`, which the host stylesheet `editor.css` styles
 * with `margin: 20px auto`. When that SVG is embedded in foreign
 * hosts (card-procedure docs, XMP annotations, etc.) the margin
 * leaks across and pushes the SVG ~20px down inside its frame.
 * Stripping the id on export keeps the bytes host-agnostic.
 */

import { describe, expect, it } from "vitest";
import { CanvasManager } from "./canvas-manager.js";
import { exportAnnotationsSvgForIdb, exportSVGString } from "./export.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

function makeCanvas(): CanvasManager {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(container, "clientHeight", { configurable: true, value: 600 });
  document.body.appendChild(container);
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  // Mirror the editor shell's live-canvas convention: the SVG that
  // CanvasManager owns is `<svg id="svg-root">`. This is the bit
  // that historically leaked into card-procedure docs and caused
  // the grey-strip regression.
  svg.id = "svg-root";
  container.appendChild(svg);
  return new CanvasManager(svg, PNG, 400, 300);
}

describe("exportSVGString", () => {
  it("strips the editor-shell `id` attribute so foreign hosts don't inherit `#svg-root` styling", () => {
    const cm = makeCanvas();
    const out = exportSVGString(cm);
    // The output starts with the `<?xml ?>` prologue (kept for
    // standalone-file callers) — but the inline SVG must NOT carry
    // `id="svg-root"`. A naive substring check is enough; the editor
    // doesn't emit any other `id="svg-root"` reference in the body.
    expect(out).not.toContain('id="svg-root"');
  });

  it("keeps the `<?xml ?>` prologue + the canvas image dimensions", () => {
    const cm = makeCanvas();
    const out = exportSVGString(cm);
    expect(out).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(out).toMatch(/width="400"/);
    expect(out).toMatch(/height="300"/);
  });
});

describe("exportAnnotationsSvgForIdb (annotations-only flow)", () => {
  it("strips the editor-shell `id` for symmetry with the full-SVG path", () => {
    const cm = makeCanvas();
    const out = exportAnnotationsSvgForIdb(cm);
    expect(out).not.toContain('id="svg-root"');
  });
});
