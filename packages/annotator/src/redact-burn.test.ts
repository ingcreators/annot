// Tests for the redact-burn primitive. Uses a real `@napi-rs/canvas`
// roundtrip on a tiny synthetic PNG — no fixture file needed.
//
// Phase 3e of `docs/plans/living-spec-authoring-roadmap.md`
// (Phase 3 follow-up). Moved alongside `redact-burn.ts` from
// `packages/mcp/src/redact/burn.test.ts`. The MCP-local
// `readPngDimensions` helper is inlined as `pngDims` so this
// test stays self-contained inside the annotator package.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, test } from "vitest";

import { burnRedactions, burnRegions } from "./redact-burn.js";

/**
 * Minimal IHDR-chunk reader. The first 8 bytes are the PNG magic;
 * the next 8 bytes are the IHDR chunk length + type; width and
 * height are two big-endian uint32s at offsets 16 and 20. This is
 * enough to assert the burn output is a valid PNG with the
 * expected dimensions, which is all the original test needed.
 */
function pngDims(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24) throw new Error("pngDims: input too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function whiteCanvasPng(width: number, height: number): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const buf = canvas.toBuffer("image/png");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe("burnRedactions", () => {
  test("no regions → returns input verbatim", async () => {
    const png = whiteCanvasPng(50, 30);
    const out = await burnRedactions(png, []);
    expect(out).toBe(png);
  });

  test("solid: produces a valid PNG with same dimensions", async () => {
    const png = whiteCanvasPng(100, 80);
    const out = await burnRedactions(png, [
      { bbox: { x: 10, y: 10, width: 50, height: 30 }, style: "solid", color: "#ff0000" },
    ]);
    expect(out).not.toBe(png);
    expect(pngDims(out)).toEqual({ width: 100, height: 80 });
  });

  test("mosaic: produces a valid PNG", async () => {
    const png = whiteCanvasPng(64, 64);
    const out = await burnRedactions(png, [
      { bbox: { x: 0, y: 0, width: 64, height: 64 }, style: "mosaic" },
    ]);
    expect(pngDims(out)).toEqual({ width: 64, height: 64 });
  });

  test("blur: produces a valid PNG", async () => {
    const png = whiteCanvasPng(48, 48);
    const out = await burnRedactions(png, [
      { bbox: { x: 5, y: 5, width: 30, height: 30 }, style: "blur" },
    ]);
    expect(pngDims(out)).toEqual({ width: 48, height: 48 });
  });

  test("multiple regions all process", async () => {
    const png = whiteCanvasPng(200, 200);
    const out = await burnRedactions(png, [
      { bbox: { x: 0, y: 0, width: 30, height: 30 }, style: "solid", color: "#000" },
      { bbox: { x: 100, y: 50, width: 40, height: 40 }, style: "mosaic" },
      { bbox: { x: 150, y: 150, width: 30, height: 30 }, style: "blur" },
    ]);
    expect(pngDims(out)).toEqual({ width: 200, height: 200 });
  });

  test("zero-area regions are skipped", async () => {
    const png = whiteCanvasPng(40, 40);
    const out = await burnRedactions(png, [
      { bbox: { x: 5, y: 5, width: 0, height: 0 }, style: "solid" },
    ]);
    expect(pngDims(out)).toEqual({ width: 40, height: 40 });
  });

  test("default style is solid black", async () => {
    const png = whiteCanvasPng(20, 20);
    // No style / color specified — should fall back to solid black.
    const out = await burnRedactions(png, [{ bbox: { x: 5, y: 5, width: 10, height: 10 } }]);
    expect(pngDims(out)).toEqual({ width: 20, height: 20 });
    // Sanity-check: the output bytes differ from a no-op burn.
    const noop = await burnRedactions(png, []);
    expect(out).not.toEqual(noop);
  });
});

// ─── Phase 3k — burnRegions alias ──────────────────────────────

describe("burnRegions (alias for burnRedactions)", () => {
  test("is identity-equal to burnRedactions", () => {
    // Picking one name over the other is purely a docs choice;
    // the export is the same function reference.
    expect(burnRegions).toBe(burnRedactions);
  });

  test("produces byte-identical output to burnRedactions for the same input", async () => {
    const png = whiteCanvasPng(40, 40);
    const regions: Parameters<typeof burnRegions>[1] = [
      { bbox: { x: 5, y: 5, width: 20, height: 10 }, style: "mosaic" },
    ];
    const viaRedactions = await burnRedactions(png, regions);
    const viaRegions = await burnRegions(png, regions);
    expect(Array.from(viaRegions)).toEqual(Array.from(viaRedactions));
  });
});
