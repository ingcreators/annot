/**
 * Pure-helper tests for the encode option types. The full
 * `encodeCapture()` pipeline exercises WASM + OffscreenCanvas, so
 * end-to-end tests live in the consumer packages where a real
 * browser environment is available; this file stays Tier-A pure.
 */

import { describe, expect, it } from "vitest";
import {
  computeResizeTarget,
  DEFAULT_ENCODE_OPTIONS,
  SAVE_SIZE_LABEL,
  SAVE_SIZE_MAX_WIDTH,
} from "./options.js";

describe("DEFAULT_ENCODE_OPTIONS", () => {
  it("defaults `saveSizePreset` to 'standard' (1920px)", () => {
    expect(DEFAULT_ENCODE_OPTIONS.saveSizePreset).toBe("standard");
    expect(SAVE_SIZE_MAX_WIDTH.standard).toBe(1920);
  });
});

describe("SAVE_SIZE_MAX_WIDTH", () => {
  it("matches the spec values", () => {
    expect(SAVE_SIZE_MAX_WIDTH.light).toBe(1280);
    expect(SAVE_SIZE_MAX_WIDTH.standard).toBe(1920);
    expect(SAVE_SIZE_MAX_WIDTH.highQuality).toBe(2560);
    expect(SAVE_SIZE_MAX_WIDTH.original).toBeNull();
  });
});

describe("SAVE_SIZE_LABEL", () => {
  it("includes the px hint so the dialog selector is unambiguous", () => {
    expect(SAVE_SIZE_LABEL.light).toContain("1280");
    expect(SAVE_SIZE_LABEL.standard).toContain("1920");
    expect(SAVE_SIZE_LABEL.highQuality).toContain("2560");
    expect(SAVE_SIZE_LABEL.original).toBe("Original");
  });
});

describe("computeResizeTarget", () => {
  it("returns the source unchanged when preset is 'original'", () => {
    const r = computeResizeTarget(3840, 2160, "original");
    expect(r).toEqual({ width: 3840, height: 2160, scaled: false });
  });

  it("returns the source unchanged when source is narrower than the cap", () => {
    const r = computeResizeTarget(1024, 768, "standard");
    expect(r).toEqual({ width: 1024, height: 768, scaled: false });
  });

  it("scales 4K source down to standard preset preserving aspect", () => {
    const r = computeResizeTarget(3840, 2160, "standard");
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
    expect(r.scaled).toBe(true);
  });

  it("rounds height to the nearest pixel for non-16:9 sources", () => {
    // 1916×1872 (≈1:1) at standard cap: 1920 doesn't trigger
    // (source narrower); use light cap to force scale.
    const r = computeResizeTarget(1916, 1872, "light");
    expect(r.width).toBe(1280);
    // 1872 / 1916 * 1280 ≈ 1250.6 → 1251
    expect(r.height).toBe(1251);
    expect(r.scaled).toBe(true);
  });

  it("never returns a 0-px height for extreme aspect ratios", () => {
    const r = computeResizeTarget(10000, 1, "light");
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it("respects each non-original preset's max-width", () => {
    expect(computeResizeTarget(4000, 4000, "light").width).toBe(1280);
    expect(computeResizeTarget(4000, 4000, "standard").width).toBe(1920);
    expect(computeResizeTarget(4000, 4000, "highQuality").width).toBe(2560);
    expect(computeResizeTarget(4000, 4000, "original").width).toBe(4000);
  });
});
