// @vitest-environment happy-dom

/**
 * Round-trip tests for the localStorage-backed encode options
 * loader. The merge logic is forgiving by design — drop unknown
 * keys, swap invalid values for defaults — so existing user
 * blobs survive a schema extension without being rejected.
 */

import { DEFAULT_ENCODE_OPTIONS } from "@ingcreators/annot-core/encode/options";
import { afterEach, describe, expect, it } from "vitest";
import { loadEncodeOptions, saveEncodeOptions } from "./encode-options.js";

afterEach(() => {
  localStorage.clear();
});

describe("loadEncodeOptions", () => {
  it("returns DEFAULT_ENCODE_OPTIONS when nothing is stored", () => {
    expect(loadEncodeOptions()).toEqual(DEFAULT_ENCODE_OPTIONS);
  });

  it("round-trips a fully-formed object", () => {
    const opts = {
      format: "jpeg" as const,
      smartFallback: "jpeg" as const,
      smartColorThreshold: 9000,
      jpegPercent: 80,
      saveSizePreset: "highQuality" as const,
    };
    saveEncodeOptions(opts);
    expect(loadEncodeOptions()).toEqual(opts);
  });

  it("falls back to default saveSizePreset when missing from stored blob", () => {
    // Simulate a pre-feature stored blob (no saveSizePreset key).
    localStorage.setItem(
      "annot-encode-options",
      JSON.stringify({
        format: "smart",
        smartFallback: "png",
        smartColorThreshold: 15000,
        jpegPercent: 92,
      }),
    );
    expect(loadEncodeOptions().saveSizePreset).toBe(DEFAULT_ENCODE_OPTIONS.saveSizePreset);
  });

  it("falls back to default saveSizePreset when stored value is unrecognised", () => {
    localStorage.setItem(
      "annot-encode-options",
      JSON.stringify({ ...DEFAULT_ENCODE_OPTIONS, saveSizePreset: "garbage" }),
    );
    expect(loadEncodeOptions().saveSizePreset).toBe(DEFAULT_ENCODE_OPTIONS.saveSizePreset);
  });

  it.each([
    "light",
    "standard",
    "highQuality",
    "original",
  ])("accepts the recognised saveSizePreset value '%s'", (preset) => {
    localStorage.setItem(
      "annot-encode-options",
      JSON.stringify({ ...DEFAULT_ENCODE_OPTIONS, saveSizePreset: preset }),
    );
    expect(loadEncodeOptions().saveSizePreset).toBe(preset);
  });
});
