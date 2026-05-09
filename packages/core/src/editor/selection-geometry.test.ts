// Pure-Node test — no DOM. selection-geometry holds the snap, rotate,
// and cursor-direction math previously buried inside SelectionManager
// and smart-guides; running these under the default `node` test
// environment also doubles as a leak check.

import { describe, expect, it } from "vitest";
import { computeSnap, cursorForAngle, type Rect, rotateAround } from "./selection-geometry.js";

const r = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

describe("rotateAround", () => {
  it("returns the input point when rad = 0", () => {
    const out = rotateAround(10, 20, 0, 0, 0);
    expect(out.x).toBeCloseTo(10, 9);
    expect(out.y).toBeCloseTo(20, 9);
  });

  it("rotates 90° CCW around the origin", () => {
    // (1, 0) rotated by π/2 around (0,0) → (0, 1).
    const out = rotateAround(1, 0, 0, 0, Math.PI / 2);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(1, 9);
  });

  it("rotates 180° around an off-origin pivot", () => {
    // (10, 10) rotated by π around (5, 5) → (0, 0).
    const out = rotateAround(10, 10, 5, 5, Math.PI);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(0, 9);
  });

  it("is invertible: rotate by rad then by -rad lands back on the input", () => {
    const start = { x: 7, y: 13 };
    const pivot = { cx: 3, cy: 5 };
    const rad = 0.7;
    const a = rotateAround(start.x, start.y, pivot.cx, pivot.cy, rad);
    const b = rotateAround(a.x, a.y, pivot.cx, pivot.cy, -rad);
    expect(b.x).toBeCloseTo(start.x, 9);
    expect(b.y).toBeCloseTo(start.y, 9);
  });
});

describe("cursorForAngle", () => {
  it("maps the 8 cardinal/diagonal angles to the matching cursor", () => {
    expect(cursorForAngle(0)).toBe("ew-resize"); // E
    expect(cursorForAngle(Math.PI / 4)).toBe("nwse-resize"); // SE
    expect(cursorForAngle(Math.PI / 2)).toBe("ns-resize"); // S
    expect(cursorForAngle((3 * Math.PI) / 4)).toBe("nesw-resize"); // SW
    expect(cursorForAngle(Math.PI)).toBe("ew-resize"); // W
    expect(cursorForAngle((5 * Math.PI) / 4)).toBe("nwse-resize"); // NW
    expect(cursorForAngle((3 * Math.PI) / 2)).toBe("ns-resize"); // N
    expect(cursorForAngle((7 * Math.PI) / 4)).toBe("nesw-resize"); // NE
  });

  it("handles negative angles by normalising into [0, 2π)", () => {
    // -π/2 == 3π/2 == "due north"
    expect(cursorForAngle(-Math.PI / 2)).toBe("ns-resize");
  });

  it("handles angles ≥ 2π via the same normalisation", () => {
    // 2π + 0 == "due east"
    expect(cursorForAngle(Math.PI * 2)).toBe("ew-resize");
    // 2π + π/2 == "due south"
    expect(cursorForAngle(Math.PI * 2 + Math.PI / 2)).toBe("ns-resize");
  });
});

describe("computeSnap — early returns", () => {
  it("returns the raw delta when no dragged boxes", () => {
    const out = computeSnap({
      draggedBoxes: [],
      otherBoxes: [r(0, 0, 100, 100)],
      dx: 5,
      dy: 7,
      threshold: 4,
    });
    expect(out).toEqual({ dx: 5, dy: 7, guides: [] });
  });

  it("returns the raw delta when no other boxes to snap to", () => {
    const out = computeSnap({
      draggedBoxes: [r(0, 0, 50, 50)],
      otherBoxes: [],
      dx: 5,
      dy: 7,
      threshold: 4,
    });
    expect(out).toEqual({ dx: 5, dy: 7, guides: [] });
  });

  it("returns the raw delta when no snap candidate is within threshold", () => {
    // Other rect is 200 units away — far outside any 4-unit threshold.
    const out = computeSnap({
      draggedBoxes: [r(0, 0, 50, 50)],
      otherBoxes: [r(500, 500, 50, 50)],
      dx: 1,
      dy: 1,
      threshold: 4,
    });
    expect(out.dx).toBe(1);
    expect(out.dy).toBe(1);
    expect(out.guides).toEqual([]);
  });
});

describe("computeSnap — snap behaviour", () => {
  it("snaps the dragged-union LEFT edge to a neighbour's LEFT when within threshold", () => {
    // Dragged box at (0..50). Pointer wants dx=+47 → left would land at
    // 47. Other box's left edge is at 50, so a +3 nudge gets us there.
    const out = computeSnap({
      draggedBoxes: [r(0, 0, 50, 50)],
      otherBoxes: [r(50, 200, 50, 50)],
      dx: 47,
      dy: 0,
      threshold: 5,
    });
    expect(out.dx).toBe(50);
    expect(out.dy).toBe(0);
    expect(out.guides).toHaveLength(1);
    expect(out.guides[0]!.x1).toBe(50);
    expect(out.guides[0]!.x2).toBe(50);
  });

  it("snaps both X and Y in a single computeSnap call when both are within threshold", () => {
    const out = computeSnap({
      draggedBoxes: [r(0, 0, 50, 50)],
      otherBoxes: [r(52, 53, 50, 50)],
      dx: 50, // → left = 50, neighbour.left = 52, diff = 2
      dy: 50, // → top = 50, neighbour.top = 53, diff = 3
      threshold: 4,
    });
    expect(out.dx).toBe(52);
    expect(out.dy).toBe(53);
    expect(out.guides).toHaveLength(2);
  });

  it("does NOT snap when the candidate is just outside threshold", () => {
    // diff = 5 but threshold = 4 → no snap, no guide.
    const out = computeSnap({
      draggedBoxes: [r(0, 0, 50, 50)],
      otherBoxes: [r(55, 200, 50, 50)],
      dx: 0,
      dy: 0,
      threshold: 4,
    });
    expect(out.dx).toBe(0);
    expect(out.dy).toBe(0);
    expect(out.guides).toEqual([]);
  });

  it("breaks ties by smallest absolute delta", () => {
    // Two candidates: neighbour.left = 51 (diff 1), neighbour.right = 200 (diff 150).
    // Best should be 1.
    const out = computeSnap({
      draggedBoxes: [r(0, 0, 50, 50)],
      otherBoxes: [r(51, 200, 149, 50)], // left=51, right=200
      dx: 50,
      dy: 0,
      threshold: 4,
    });
    expect(out.dx).toBe(51);
  });

  it("snaps the union bbox of a multi-element drag, not each element individually", () => {
    // Two dragged rects spanning 0..150. Other box at 152..202. With
    // a +0 delta the union's right edge sits at 150 — 2 away from the
    // other's left edge at 152, well within threshold = 4. Result: a
    // +2 nudge so the union right meets the other's left.
    const out = computeSnap({
      draggedBoxes: [r(0, 0, 50, 50), r(100, 0, 50, 50)],
      otherBoxes: [r(152, 0, 50, 50)],
      dx: 0,
      dy: 0,
      threshold: 4,
    });
    expect(out.dx).toBe(2);
  });
});
