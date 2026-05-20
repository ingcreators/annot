// Aggregate a pixelmatch diff mask into a list of contiguous
// changed-region bboxes. The mask is in RGBA order (4 bytes per
// pixel); pixels whose RED channel is non-zero are "diff". The
// algorithm is a simple flood-fill over rows + columns producing
// rectangle hulls per connected component.
//
// Phase 5 of `docs/plans/agent-mcp-integration.md`.

import type { BBox } from "../dsl/types.js";

/**
 * Minimum pixel count a region must reach before we emit it as an
 * annotation. Below this, the region is treated as anti-aliasing
 * noise and dropped. Kept low because pixelmatch in `diffMask` mode
 * already filters subpixel AA.
 */
const MIN_REGION_PIXELS = 4;

/**
 * Walk a pixelmatch diff mask and return one bbox per contiguous
 * changed region. 4-connected adjacency.
 */
export function aggregateDiffRegions(diffRgba: Uint8Array, width: number, height: number): BBox[] {
  const visited = new Uint8Array(width * height);
  const regions: BBox[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      if (!isDiff(diffRgba, idx)) continue;
      const region = floodFill(diffRgba, visited, x, y, width, height);
      if (region.count >= MIN_REGION_PIXELS) {
        regions.push({
          x: region.minX,
          y: region.minY,
          width: region.maxX - region.minX + 1,
          height: region.maxY - region.minY + 1,
        });
      }
    }
  }
  return regions;
}

function isDiff(diffRgba: Uint8Array, idx: number): boolean {
  // diffMask mode draws red (255, 0, 0) on changed pixels with
  // alpha 255; unchanged pixels have alpha 0.
  return diffRgba[idx * 4 + 3]! > 0;
}

interface RegionAccumulator {
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function floodFill(
  diffRgba: Uint8Array,
  visited: Uint8Array,
  startX: number,
  startY: number,
  width: number,
  height: number,
): RegionAccumulator {
  // Iterative BFS with a flat Int32Array stack. Recursion would
  // overflow on full-screen diff regions.
  const acc: RegionAccumulator = {
    count: 0,
    minX: startX,
    minY: startY,
    maxX: startX,
    maxY: startY,
  };
  const stack: number[] = [startX, startY];
  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx]) continue;
    if (!isDiff(diffRgba, idx)) continue;
    visited[idx] = 1;
    acc.count += 1;
    if (x < acc.minX) acc.minX = x;
    if (y < acc.minY) acc.minY = y;
    if (x > acc.maxX) acc.maxX = x;
    if (y > acc.maxY) acc.maxY = y;
    stack.push(x + 1, y);
    stack.push(x - 1, y);
    stack.push(x, y + 1);
    stack.push(x, y - 1);
  }
  return acc;
}
