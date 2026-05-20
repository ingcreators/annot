import { describe, expect, test } from "vitest";

import { aggregateDiffRegions } from "./aggregate.js";

/** Build a synthetic RGBA mask with diff pixels at the given indices. */
function buildMask(width: number, height: number, diffPixels: Array<[number, number]>): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (const [x, y] of diffPixels) {
    const idx = (y * width + x) * 4;
    rgba[idx] = 255;
    rgba[idx + 1] = 0;
    rgba[idx + 2] = 0;
    rgba[idx + 3] = 255;
  }
  return rgba;
}

describe("aggregateDiffRegions", () => {
  test("empty mask → no regions", () => {
    const mask = buildMask(10, 10, []);
    expect(aggregateDiffRegions(mask, 10, 10)).toEqual([]);
  });

  test("single rectangular region", () => {
    const pixels: Array<[number, number]> = [];
    for (let y = 2; y < 6; y++) {
      for (let x = 3; x < 8; x++) {
        pixels.push([x, y]);
      }
    }
    const mask = buildMask(20, 20, pixels);
    expect(aggregateDiffRegions(mask, 20, 20)).toEqual([{ x: 3, y: 2, width: 5, height: 4 }]);
  });

  test("two disjoint regions", () => {
    const region1: Array<[number, number]> = [];
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        region1.push([x, y]);
      }
    }
    const region2: Array<[number, number]> = [];
    for (let y = 10; y < 13; y++) {
      for (let x = 10; x < 13; x++) {
        region2.push([x, y]);
      }
    }
    const mask = buildMask(20, 20, [...region1, ...region2]);
    const regions = aggregateDiffRegions(mask, 20, 20);
    expect(regions).toHaveLength(2);
    expect(regions).toContainEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(regions).toContainEqual({ x: 10, y: 10, width: 3, height: 3 });
  });

  test("regions below MIN_REGION_PIXELS are dropped", () => {
    // Single isolated diff pixel — only 1 pixel, below the 4-pixel
    // minimum.
    const mask = buildMask(20, 20, [[5, 5]]);
    expect(aggregateDiffRegions(mask, 20, 20)).toEqual([]);
  });

  test("L-shaped region is captured as a single bbox", () => {
    const pixels: Array<[number, number]> = [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ];
    const mask = buildMask(10, 10, pixels);
    const regions = aggregateDiffRegions(mask, 10, 10);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toEqual({ x: 0, y: 0, width: 3, height: 3 });
  });

  test("does not crash on diff-heavy masks (1000+ pixels)", () => {
    const pixels: Array<[number, number]> = [];
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        pixels.push([x, y]);
      }
    }
    const mask = buildMask(50, 50, pixels);
    const regions = aggregateDiffRegions(mask, 50, 50);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.width).toBe(40);
    expect(regions[0]?.height).toBe(40);
  });
});
