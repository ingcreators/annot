// Pure-Node test (no DOM) — viewport-math.ts is Tier B but the math
// itself is Tier A in spirit (numbers in, numbers out). Running it
// under the default node environment also doubles as a leak check:
// any DOM access would fail immediately.

import { describe, expect, it } from "vitest";
import {
  applyInverseAffine,
  clampZoom,
  computeFitZoom,
  computeRenderedSize,
  DEFAULT_MAX_ZOOM,
  DEFAULT_MIN_ZOOM,
  FIT_VIEW_PADDING,
} from "./viewport-math.js";

describe("clampZoom", () => {
  it("returns the input when inside the default range", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.5)).toBe(0.5);
    expect(clampZoom(3)).toBe(3);
  });

  it("clamps below the default minimum", () => {
    expect(clampZoom(0.05)).toBe(DEFAULT_MIN_ZOOM);
    expect(clampZoom(-1)).toBe(DEFAULT_MIN_ZOOM);
  });

  it("clamps above the default maximum", () => {
    expect(clampZoom(10)).toBe(DEFAULT_MAX_ZOOM);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MAX_ZOOM);
  });

  it("respects explicit overrides", () => {
    expect(clampZoom(0.5, 0.25, 2)).toBe(0.5);
    expect(clampZoom(3, 0.25, 2)).toBe(2);
    expect(clampZoom(0.1, 0.25, 2)).toBe(0.25);
  });
});

describe("computeFitZoom", () => {
  it("fits an image into a larger container without exceeding 1×", () => {
    // 200×100 image into a 1000×1000 container (after padding 960×960):
    // candidate scales = 4.8 / 9.6 / 1, so cap at 1.
    expect(computeFitZoom(200, 100, 1000, 1000)).toBe(1);
  });

  it("fits an oversize image to the limiting dimension", () => {
    // 1000×800 image into 500×600 container, default padding 40:
    // cw = 460, ch = 560 → min(460/1000, 560/800, 1) = 0.46
    expect(computeFitZoom(1000, 800, 500, 600)).toBeCloseTo(0.46, 6);
  });

  it("uses the height ratio when it is the smaller axis", () => {
    // 1000×2000 image into 1000×800 container (after padding 960×760):
    // min(0.96, 0.38, 1) = 0.38
    expect(computeFitZoom(1000, 2000, 1000, 800)).toBeCloseTo(0.38, 6);
  });

  it("returns 0 when the container is smaller than the padding", () => {
    expect(computeFitZoom(100, 100, 30, 30)).toBe(0);
    expect(computeFitZoom(100, 100, FIT_VIEW_PADDING, FIT_VIEW_PADDING)).toBe(0);
  });

  it("returns 0 for a zero-sized image", () => {
    expect(computeFitZoom(0, 100, 1000, 1000)).toBe(0);
    expect(computeFitZoom(100, 0, 1000, 1000)).toBe(0);
  });

  it("respects an alternative padding", () => {
    // No padding → exact fit ratios.
    expect(computeFitZoom(1000, 800, 500, 600, 0)).toBe(0.5);
  });

  it("respects an alternative max zoom", () => {
    // Tiny image in a huge container with maxZoom = 4.
    expect(computeFitZoom(100, 100, 1040, 1040, 40, 4)).toBe(4);
  });
});

describe("computeRenderedSize", () => {
  it("rounds the rendered pixel size to integers", () => {
    expect(computeRenderedSize(100, 100, 0.333)).toEqual({ width: 33, height: 33 });
    expect(computeRenderedSize(100, 100, 0.5)).toEqual({ width: 50, height: 50 });
    expect(computeRenderedSize(1000, 800, 0.5)).toEqual({ width: 500, height: 400 });
  });

  it("returns 0 / 0 for zoom 0", () => {
    expect(computeRenderedSize(1000, 800, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe("applyInverseAffine", () => {
  it("inverts the identity matrix into itself", () => {
    const id = [1, 0, 0, 1, 0, 0] as const;
    expect(applyInverseAffine(id, 42, 17)).toEqual({ x: 42, y: 17 });
  });

  it("undoes a uniform scale", () => {
    // 2× scale matrix: client = 2 * svg, so svg = 0.5 * client.
    const m = [2, 0, 0, 2, 0, 0] as const;
    expect(applyInverseAffine(m, 100, 80)).toEqual({ x: 50, y: 40 });
  });

  it("undoes a translation", () => {
    // pure translate by (50, 30): client = svg + (50, 30).
    const m = [1, 0, 0, 1, 50, 30] as const;
    expect(applyInverseAffine(m, 150, 80)).toEqual({ x: 100, y: 50 });
  });

  it("undoes scale + translate (zoomed canvas with offset)", () => {
    // Mimics what getScreenCTM() returns for a CanvasManager whose
    // <svg> is rendered at 0.5× starting at client (50, 30):
    //   client = 0.5 * svg + (50, 30)
    //   svg    = 2 * (client - (50, 30))
    const m = [0.5, 0, 0, 0.5, 50, 30] as const;
    const out = applyInverseAffine(m, 250, 130);
    expect(out.x).toBeCloseTo(400, 6);
    expect(out.y).toBeCloseTo(200, 6);
  });

  it("throws on a singular matrix", () => {
    const m = [0, 0, 0, 0, 0, 0] as const;
    expect(() => applyInverseAffine(m, 1, 1)).toThrow(/singular/);
  });
});
