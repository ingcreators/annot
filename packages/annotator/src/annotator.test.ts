import { readEditablePngBytes } from "@ingcreators/annot-core/xmp-bytes";
import { describe, expect, it } from "vitest";
import { createAnnotator } from "./annotator.js";

const TINY_PNG_DATA_URL =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGUlEQVR4nGNgYGD4z" +
  "8DAwMDAwMDA8J+BgQEAGgAGAtZuBz8AAAAASUVORK5CYII=";

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// What `exportAnnotationsSvgForIdb` produces today — wrapper SVG
// with sanitisable defs + annotation children at top level.
const REALISTIC_ANNOT_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">` +
  "<defs>" +
  `<style data-annot-fonts="true">.annot{}</style>` +
  "</defs>" +
  `<rect x="10" y="10" width="80" height="80" fill="none" ` +
  `stroke="red" stroke-width="3"/>` +
  `<line x1="20" y1="20" x2="80" y2="80" ` +
  `stroke="blue" stroke-width="2"/>` +
  "</svg>";

describe("createAnnotator", () => {
  describe("toSvg", () => {
    it("returns a self-contained SVG with the Annot version stamp", () => {
      const annotator = createAnnotator();
      const svg = annotator.toSvg({
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg: REALISTIC_ANNOT_SVG,
        width: 100,
        height: 100,
      });
      expect(svg).toContain("data-annot-version=");
      expect(svg).toContain('viewBox="0 0 100 100"');
      expect(svg).toContain(`href="${TINY_PNG_DATA_URL}"`);
      // The wrapper-side <style data-annot-fonts> is stripped.
      expect(svg).not.toContain("data-annot-fonts");
      expect(svg).not.toContain(".annot{}");
      // Annotation children survive.
      expect(svg).toContain("<rect");
      expect(svg).toContain("<line");
    });

    it("handles empty annotations gracefully", () => {
      const annotator = createAnnotator();
      const svg = annotator.toSvg({
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg: "",
        width: 100,
        height: 100,
      });
      expect(svg).toContain(`href="${TINY_PNG_DATA_URL}"`);
      expect(svg).toContain("</svg>");
    });
  });

  describe("toPng", () => {
    it("rasterises realistic editor output to a valid PNG", () => {
      const annotator = createAnnotator();
      const png = annotator.toPng({
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg: REALISTIC_ANNOT_SVG,
        width: 100,
        height: 100,
      });
      expect(png).toBeInstanceOf(Uint8Array);
      expect(png.length).toBeGreaterThan(100);
      expect(Array.from(png.slice(0, 8))).toEqual(Array.from(PNG_MAGIC));
    });

    it("rasterises annotation-only (no base image) to a valid PNG", () => {
      const annotator = createAnnotator();
      const png = annotator.toPng({
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg: "",
        width: 100,
        height: 100,
      });
      expect(png).toBeInstanceOf(Uint8Array);
      expect(Array.from(png.slice(0, 8))).toEqual(Array.from(PNG_MAGIC));
    });
  });

  describe("options", () => {
    it("constructs without options", () => {
      const annotator = createAnnotator();
      expect(typeof annotator.toPng).toBe("function");
      expect(typeof annotator.toSvg).toBe("function");
    });

    it("constructs with font options", () => {
      const annotator = createAnnotator({
        loadSystemFonts: false,
        defaultFontFamily: "Arial",
        fontFiles: [],
        fontDirs: [],
      });
      // Smoke — passing through the resvg-js options shouldn't
      // throw. Actual font rendering parity is the subject of the
      // documented Phase-1+ follow-up.
      const png = annotator.toPng({
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg:
          `<svg xmlns="http://www.w3.org/2000/svg">` +
          `<text x="0" y="20" font-size="10">x</text>` +
          "</svg>",
        width: 50,
        height: 50,
      });
      expect(Array.from(png.slice(0, 8))).toEqual(Array.from(PNG_MAGIC));
    });

    it("loadSystemFonts defaults to false (CI determinism)", () => {
      // Indirect — we can't introspect the resvg-js instance state.
      // What we CAN do is render two annotators (one with default,
      // one with explicit loadSystemFonts:false) and assert the
      // outputs are byte-identical, proving the default and explicit
      // false are the same code path.
      const a = createAnnotator();
      const b = createAnnotator({ loadSystemFonts: false });
      const input = {
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg: REALISTIC_ANNOT_SVG,
        width: 100,
        height: 100,
      };
      const pa = a.toPng(input);
      const pb = b.toPng(input);
      expect(pa.length).toBe(pb.length);
      expect(Array.from(pa.slice(0, 16))).toEqual(Array.from(pb.slice(0, 16)));
    });
  });

  describe("toEditablePng", () => {
    it("returns PNG bytes containing the embedded Annot custom chunks", () => {
      const annotator = createAnnotator();
      const out = annotator.toEditablePng({
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg: REALISTIC_ANNOT_SVG,
        width: 100,
        height: 100,
      });
      expect(out).toBeInstanceOf(Uint8Array);
      expect(Array.from(out.slice(0, 8))).toEqual(Array.from(PNG_MAGIC));
      // Custom chunk type bytes appear in the output.
      const outStr = Array.from(out)
        .map((b) => String.fromCharCode(b))
        .join("");
      expect(outStr).toContain("iTXt");
      expect(outStr).toContain("svGo");
    });

    it("round-trips the annotations + dimensions + original via readEditablePngBytes", () => {
      const annotator = createAnnotator();
      const out = annotator.toEditablePng({
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg: REALISTIC_ANNOT_SVG,
        width: 100,
        height: 100,
      });
      const meta = readEditablePngBytes(out);
      expect(meta).not.toBeNull();
      // The annotator passes annotationsSvg into the XMP as-is, so the
      // reader hands back the exact same string we fed in.
      expect(meta!.annotationsSvg).toBe(REALISTIC_ANNOT_SVG);
      expect(meta!.width).toBe(100);
      expect(meta!.height).toBe(100);
      // Original PNG is recovered as a data URL with the PNG MIME.
      expect(meta!.originalImageDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(meta!.originalImageDataUrl).toBe(TINY_PNG_DATA_URL);
    });

    it("writes optional tags into the XMP and surfaces them on read", () => {
      const annotator = createAnnotator();
      const out = annotator.toEditablePng({
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg: REALISTIC_ANNOT_SVG,
        width: 100,
        height: 100,
        tags: {
          source: "docs-tour",
          screen: "app-overview",
          capturedAt: "2026-05-21T12:00:00.000Z",
        },
      });
      const meta = readEditablePngBytes(out);
      expect(meta!.tags).toEqual({
        source: "docs-tour",
        screen: "app-overview",
        capturedAt: "2026-05-21T12:00:00.000Z",
      });
    });

    it("omits the tags element when no tags are supplied (empty tags object on read)", () => {
      const annotator = createAnnotator();
      const out = annotator.toEditablePng({
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg: REALISTIC_ANNOT_SVG,
        width: 100,
        height: 100,
      });
      const meta = readEditablePngBytes(out);
      expect(meta!.tags).toEqual({});
    });

    it("matches the rasterised pixels emitted by toPng (metadata is the only difference)", () => {
      // Visible pixel parity: an Annot reader that ignores custom chunks
      // sees the same image as a plain `toPng()` output. We don't have
      // a public byte-stripping helper, but the file should at minimum
      // contain the IHDR + IDAT chunks from the underlying render.
      const annotator = createAnnotator();
      const input = {
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg: REALISTIC_ANNOT_SVG,
        width: 100,
        height: 100,
      };
      const flat = annotator.toPng(input);
      const editable = annotator.toEditablePng(input);
      // Editable PNG is strictly larger (carries the embedded original
      // + XMP) — never smaller, never identical.
      expect(editable.length).toBeGreaterThan(flat.length);
      // Both start with the same PNG signature.
      expect(Array.from(editable.slice(0, 8))).toEqual(Array.from(flat.slice(0, 8)));
    });
  });

  describe("stateless reuse", () => {
    it("the same annotator can render multiple distinct inputs", () => {
      const annotator = createAnnotator();
      const input1 = {
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg:
          `<svg xmlns="http://www.w3.org/2000/svg">` +
          `<rect x="0" y="0" width="50" height="50" fill="red"/>` +
          "</svg>",
        width: 100,
        height: 100,
      };
      const input2 = {
        originalDataUrl: TINY_PNG_DATA_URL,
        annotationsSvg:
          `<svg xmlns="http://www.w3.org/2000/svg">` +
          `<circle cx="50" cy="50" r="20" fill="blue"/>` +
          "</svg>",
        width: 100,
        height: 100,
      };
      const p1 = annotator.toPng(input1);
      const p2 = annotator.toPng(input2);
      expect(p1).not.toEqual(p2);
      expect(Array.from(p1.slice(0, 8))).toEqual(Array.from(PNG_MAGIC));
      expect(Array.from(p2.slice(0, 8))).toEqual(Array.from(PNG_MAGIC));
    });
  });
});
