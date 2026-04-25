// Pure-Node tests for capture-strategy. Every input is a plain
// number / object; no chrome.* APIs, no DOM. Drives every branch of
// the segment plan + window-size math.

import { describe, expect, it } from "vitest";
import {
  computeChromeDelta,
  computeDesiredWindowSize,
  MIN_WINDOW_DIMENSION,
  pixelToCssSize,
  planScrollSegments,
} from "./capture-strategy.js";
import { MAX_CANVAS_DIMENSION } from "./service-worker-helpers.js";

// ─── computeChromeDelta ──────────────────────────────────────────────

describe("computeChromeDelta", () => {
  it("subtracts the inner viewport from the outer window for both axes", () => {
    expect(computeChromeDelta({ width: 1280, height: 800 }, { width: 1264, height: 720 })).toEqual({
      width: 16,
      height: 80,
    });
  });

  it("clamps negative deltas (transparent overlay edge case) to 0", () => {
    // Some pages report a viewport LARGER than the window when a
    // translucent address bar overlays the page area; we don't want
    // a negative chrome height to subtract from the desired window.
    expect(computeChromeDelta({ width: 100, height: 100 }, { width: 200, height: 200 })).toEqual({
      width: 0,
      height: 0,
    });
  });

  it("returns zeros when either side is missing (window not yet measured)", () => {
    expect(computeChromeDelta({}, { width: 1264, height: 720 })).toEqual({ width: 0, height: 0 });
    expect(computeChromeDelta({ width: 1280, height: 800 }, {})).toEqual({ width: 0, height: 0 });
    expect(computeChromeDelta({}, {})).toEqual({ width: 0, height: 0 });
  });
});

// ─── pixelToCssSize ──────────────────────────────────────────────────

describe("pixelToCssSize", () => {
  it("returns the input unchanged when DPR = 1", () => {
    expect(pixelToCssSize({ width: 1920, height: 1080 }, 1)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("divides by DPR for high-density displays", () => {
    expect(pixelToCssSize({ width: 1920, height: 1080 }, 2)).toEqual({ width: 960, height: 540 });
    expect(pixelToCssSize({ width: 1920, height: 1080 }, 1.5)).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("rounds to integers (window-size APIs require ints)", () => {
    // 100/3 = 33.333 → 33; 200/3 = 66.666 → 67.
    expect(pixelToCssSize({ width: 100, height: 200 }, 3)).toEqual({ width: 33, height: 67 });
  });

  it("treats DPR <= 0 as 1 to avoid division by zero", () => {
    expect(pixelToCssSize({ width: 100, height: 200 }, 0)).toEqual({ width: 100, height: 200 });
    expect(pixelToCssSize({ width: 100, height: 200 }, -2)).toEqual({ width: 100, height: 200 });
  });
});

// ─── computeDesiredWindowSize ────────────────────────────────────────

describe("computeDesiredWindowSize", () => {
  it("at DPR=1 with no chrome delta, returns the pixel target verbatim", () => {
    expect(computeDesiredWindowSize({ width: 1280, height: 720 }, 1, { width: 0, height: 0 })).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("adds the chrome delta to land the inner viewport on target", () => {
    // Target: 1280×720 pixels. DPR=1 → CSS 1280×720. Chrome
    // delta 16×100 → outer window must be 1296×820.
    expect(
      computeDesiredWindowSize({ width: 1280, height: 720 }, 1, { width: 16, height: 100 }),
    ).toEqual({ width: 1296, height: 820 });
  });

  it("compensates for high DPR by halving the CSS target before adding chrome", () => {
    // Target 1920×1080 physical at DPR=2 → CSS 960×540, plus 16×100
    // chrome → 976×640 outer window.
    expect(
      computeDesiredWindowSize({ width: 1920, height: 1080 }, 2, { width: 16, height: 100 }),
    ).toEqual({ width: 976, height: 640 });
  });

  it("clamps each dimension to MIN_WINDOW_DIMENSION", () => {
    // Tiny target: 50×50 → CSS 50×50 + 0 chrome → would be 50×50,
    // but clamps up to MIN_WINDOW_DIMENSION on each axis.
    expect(
      computeDesiredWindowSize({ width: 50, height: 50 }, 1, { width: 0, height: 0 }),
    ).toEqual({ width: MIN_WINDOW_DIMENSION, height: MIN_WINDOW_DIMENSION });
  });

  it("respects an alternative minDim", () => {
    expect(
      computeDesiredWindowSize({ width: 50, height: 50 }, 1, { width: 0, height: 0 }, 100),
    ).toEqual({ width: 100, height: 100 });
  });

  it("ignores negative chrome deltas (defensive — they would shrink the result)", () => {
    expect(
      computeDesiredWindowSize({ width: 1280, height: 720 }, 1, { width: -50, height: -50 }),
    ).toEqual({ width: 1280, height: 720 });
  });
});

// ─── planScrollSegments ──────────────────────────────────────────────

const dims = (over: Partial<Parameters<typeof planScrollSegments>[0]> = {}) => ({
  scrollWidth: 1280,
  scrollHeight: 3000,
  viewportWidth: 1280,
  viewportHeight: 800,
  devicePixelRatio: 1,
  ...over,
});

describe("planScrollSegments — segment layout", () => {
  it("produces ceil(scrollHeight / vpHeight) segments", () => {
    const plan = planScrollSegments(dims({ scrollHeight: 3000, viewportHeight: 800 }));
    // ceil(3000/800) = 4
    expect(plan.segments).toHaveLength(4);
  });

  it("walks scrollY top-down at viewport-height intervals for non-last segments", () => {
    const plan = planScrollSegments(dims({ scrollHeight: 3000, viewportHeight: 800 }));
    // numSegments=4. Non-last segments at i*800.
    expect(plan.segments[0]!.scrollY).toBe(0);
    expect(plan.segments[1]!.scrollY).toBe(800);
    expect(plan.segments[2]!.scrollY).toBe(1600);
  });

  it("shifts the last segment upward so its bottom aligns with the page bottom", () => {
    // 3000 / 800 = 3.75 → 4 segments. Last scrollY = 3000 - 800 = 2200,
    // NOT 3*800 = 2400 (which would put the bottom edge past the page).
    const plan = planScrollSegments(dims({ scrollHeight: 3000, viewportHeight: 800 }));
    expect(plan.segments[3]!.scrollY).toBe(2200);
    expect(plan.segments[3]!.isLast).toBe(true);
  });

  it("handles an exact multiple of the viewport (last segment NOT shifted)", () => {
    // 2400 / 800 = 3 exactly → 3 segments at 0, 800, 1600. Last
    // segment's scrollY would be 2400 - 800 = 1600, same as the
    // i*vp formula. Both expressions land on 1600.
    const plan = planScrollSegments(dims({ scrollHeight: 2400, viewportHeight: 800 }));
    expect(plan.segments).toHaveLength(3);
    expect(plan.segments.map((s) => s.scrollY)).toEqual([0, 800, 1600]);
  });

  it("returns a single segment at scrollY=0 for a page shorter than one viewport", () => {
    const plan = planScrollSegments(dims({ scrollHeight: 600, viewportHeight: 800 }));
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]).toEqual({ index: 0, scrollY: 0, isLast: true });
  });

  it("flags only the last segment with isLast=true", () => {
    const plan = planScrollSegments(dims({ scrollHeight: 3000, viewportHeight: 800 }));
    const lasts = plan.segments.map((s) => s.isLast);
    expect(lasts).toEqual([false, false, false, true]);
  });

  it("survives a zero-height viewport without infinite-loop / negative scrollY", () => {
    const plan = planScrollSegments(dims({ scrollHeight: 1000, viewportHeight: 0 }));
    expect(plan.segments).toHaveLength(1000); // ceil(1000 / 1)
    // No NaN, no negative scrollY — values are all numeric.
    expect(plan.segments.every((s) => Number.isFinite(s.scrollY))).toBe(true);
  });
});

describe("planScrollSegments — stitch dimensions", () => {
  it("stitchWidth = viewportWidth × DPR", () => {
    const plan = planScrollSegments(dims({ viewportWidth: 1280, devicePixelRatio: 2 }));
    expect(plan.stitchWidth).toBe(2560);
  });

  it("stitchHeight = scrollHeight × DPR when below cap", () => {
    const plan = planScrollSegments(dims({ scrollHeight: 3000, devicePixelRatio: 2 }));
    expect(plan.stitchHeight).toBe(6000);
    expect(plan.capped).toBe(false);
  });

  it("caps stitchHeight at maxCanvasDim and reports capped=true", () => {
    // 3000 × 2 = 6000 > cap 2000 → cap kicks in.
    const plan = planScrollSegments(dims({ scrollHeight: 3000, devicePixelRatio: 2 }), 2000);
    expect(plan.stitchHeight).toBe(2000);
    expect(plan.capped).toBe(true);
  });

  it("uses the published MAX_CANVAS_DIMENSION when no override is supplied", () => {
    // Construct dims that exactly hit the cap: scrollHeight × DPR == MAX.
    const cap = MAX_CANVAS_DIMENSION;
    const plan = planScrollSegments(dims({ scrollHeight: cap, devicePixelRatio: 1 }));
    // Boundary: capped iff natural > cap. natural == cap → not capped.
    expect(plan.capped).toBe(false);
    expect(plan.stitchHeight).toBe(cap);
  });
});
