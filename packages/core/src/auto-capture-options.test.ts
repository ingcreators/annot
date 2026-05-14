/**
 * Pure-helper tests for the shared Auto Capture options leaf.
 * Tier A — runs under node, no DOM.
 */

import { describe, expect, it } from "vitest";
import {
  CAPTURE_INTERVAL_MS,
  CHANGE_SENSITIVITY_RATIO,
  DEFAULT_AUTO_CAPTURE_OPTIONS,
  isCaptureIntervalPreset,
  isChangeSensitivityPreset,
  isStableWaitPreset,
  resolveAutoCaptureOptions,
  STABLE_WAIT_MS,
} from "./auto-capture-options.js";

describe("DEFAULT_AUTO_CAPTURE_OPTIONS", () => {
  it("matches the spec §6.6 recommended defaults", () => {
    expect(DEFAULT_AUTO_CAPTURE_OPTIONS).toEqual({
      interval: "standard",
      sensitivity: "standard",
      stableWait: "short",
      ignoreCursorOnlyChanges: true,
    });
  });
});

describe("preset-to-number mappings", () => {
  it("CAPTURE_INTERVAL_MS uses spec-recommended ms values", () => {
    expect(CAPTURE_INTERVAL_MS.fast).toBe(500);
    expect(CAPTURE_INTERVAL_MS.standard).toBe(1000);
    expect(CAPTURE_INTERVAL_MS.slow).toBe(2000);
  });

  it("CHANGE_SENSITIVITY_RATIO covers a sensible range", () => {
    expect(CHANGE_SENSITIVITY_RATIO.sensitive).toBeLessThan(CHANGE_SENSITIVITY_RATIO.standard);
    expect(CHANGE_SENSITIVITY_RATIO.standard).toBeLessThan(CHANGE_SENSITIVITY_RATIO.major);
    expect(CHANGE_SENSITIVITY_RATIO.standard).toBe(0.03); // matches the engine's earlier hardcoded value
  });

  it("STABLE_WAIT_MS includes a 'none' option", () => {
    expect(STABLE_WAIT_MS.none).toBe(0);
    expect(STABLE_WAIT_MS.short).toBe(700);
    expect(STABLE_WAIT_MS.long).toBe(1500);
  });
});

describe("resolveAutoCaptureOptions", () => {
  it("resolves the defaults to engine-facing numbers", () => {
    expect(resolveAutoCaptureOptions()).toEqual({
      intervalMs: 1000,
      changeRatioThreshold: 0.03,
      stableWaitMs: 700,
      ignoreCursorOnlyChanges: true,
    });
  });

  it("resolves a non-default combination", () => {
    expect(
      resolveAutoCaptureOptions({
        interval: "fast",
        sensitivity: "major",
        stableWait: "long",
        ignoreCursorOnlyChanges: false,
      }),
    ).toEqual({
      intervalMs: 500,
      changeRatioThreshold: 0.1,
      stableWaitMs: 1500,
      ignoreCursorOnlyChanges: false,
    });
  });
});

describe("type guards", () => {
  it("isCaptureIntervalPreset accepts the three valid values", () => {
    expect(isCaptureIntervalPreset("fast")).toBe(true);
    expect(isCaptureIntervalPreset("standard")).toBe(true);
    expect(isCaptureIntervalPreset("slow")).toBe(true);
    expect(isCaptureIntervalPreset("garbage")).toBe(false);
    expect(isCaptureIntervalPreset(undefined)).toBe(false);
  });

  it("isChangeSensitivityPreset accepts only valid values", () => {
    expect(isChangeSensitivityPreset("sensitive")).toBe(true);
    expect(isChangeSensitivityPreset("standard")).toBe(true);
    expect(isChangeSensitivityPreset("major")).toBe(true);
    expect(isChangeSensitivityPreset("aggressive")).toBe(false);
  });

  it("isStableWaitPreset accepts only valid values", () => {
    expect(isStableWaitPreset("none")).toBe(true);
    expect(isStableWaitPreset("short")).toBe(true);
    expect(isStableWaitPreset("long")).toBe(true);
    expect(isStableWaitPreset(0)).toBe(false);
  });
});
