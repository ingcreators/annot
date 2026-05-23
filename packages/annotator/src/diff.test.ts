// Phase 3i of `docs/plans/living-spec-authoring-roadmap.md`
// (Phase 3 follow-up #2). Smoke tests for the relocated
// `diffScreenshots`. The detailed flood-fill behaviour lives in
// the sibling `diff-aggregate.test.ts`; this file covers the
// `diffScreenshots` shell — dimension mismatch handling +
// happy-path round-trip.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, test } from "vitest";

import { DimensionMismatchError, diffScreenshots } from "./diff.js";

function solidPng(width: number, height: number, color: string): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  const buf = canvas.toBuffer("image/png");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe("diffScreenshots", () => {
  test("identical PNGs report zero mismatched pixels + no regions", async () => {
    const png = solidPng(40, 20, "#ffffff");
    const result = await diffScreenshots(png, png);
    expect(result.mismatchedPixels).toBe(0);
    expect(result.regions).toEqual([]);
    expect(result.width).toBe(40);
    expect(result.height).toBe(20);
  });

  test("fully-different PNGs report mismatch + one full-frame region", async () => {
    const before = solidPng(20, 20, "#ffffff");
    const after = solidPng(20, 20, "#000000");
    const result = await diffScreenshots(before, after);
    expect(result.mismatchedPixels).toBe(400); // 20 * 20
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  });

  test("partial diff produces a single bounded region", async () => {
    // Paint a small red square inside an otherwise-white frame.
    const before = solidPng(60, 60, "#ffffff");
    const canvas = createCanvas(60, 60);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 60, 60);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(20, 20, 10, 10);
    const buf = canvas.toBuffer("image/png");
    const after = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    const result = await diffScreenshots(before, after);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]).toMatchObject({
      x: 20,
      y: 20,
      width: 10,
      height: 10,
    });
  });

  test("dimension mismatch throws DimensionMismatchError with both sizes in the message", async () => {
    const before = solidPng(40, 20, "#ffffff");
    const after = solidPng(40, 30, "#ffffff");
    await expect(diffScreenshots(before, after)).rejects.toThrowError(DimensionMismatchError);
    await expect(diffScreenshots(before, after)).rejects.toThrowError(/40×20.*40×30/);
  });
});
