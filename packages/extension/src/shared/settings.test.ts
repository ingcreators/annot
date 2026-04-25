// Pure-Node tests for the static-decision pieces of settings.ts:
// - `shouldHideOverlaysFor` (the core overlay-visibility matrix)
// - `parseSelectorList` (CSS selector list parsing)
//
// `loadSettings` / `saveSettings` / `onSettingsChange` etc. all call
// `chrome.storage.*` and aren't covered here — those need a Chrome
// runtime mock that's a separate concern.

import { describe, expect, it } from "vitest";
import { parseSelectorList, shouldHideOverlaysFor } from "./settings.js";

describe("shouldHideOverlaysFor — never mode", () => {
  it("never hides regardless of kind / segment / keepFirstSegment", () => {
    for (const kind of ["visible", "area", "scroll", "perPage", "click", "hotkey"] as const) {
      expect(shouldHideOverlaysFor(kind, "never", 0, false)).toBe(false);
      expect(shouldHideOverlaysFor(kind, "never", 5, true)).toBe(false);
    }
  });
});

describe("shouldHideOverlaysFor — all mode", () => {
  it("hides for every capture kind", () => {
    for (const kind of ["visible", "area", "scroll", "perPage", "click", "hotkey"] as const) {
      expect(shouldHideOverlaysFor(kind, "all", 0, false)).toBe(true);
    }
  });

  it("respects keepFirstSegment for multi-segment captures only (segment 0 visible)", () => {
    expect(shouldHideOverlaysFor("scroll", "all", 0, true)).toBe(false);
    expect(shouldHideOverlaysFor("perPage", "all", 0, true)).toBe(false);
    // Subsequent segments DO hide, even with keepFirstSegment.
    expect(shouldHideOverlaysFor("scroll", "all", 1, true)).toBe(true);
    expect(shouldHideOverlaysFor("perPage", "all", 5, true)).toBe(true);
  });

  it("ignores keepFirstSegment for single-shot captures (visible/area/click/hotkey)", () => {
    for (const kind of ["visible", "area", "click", "hotkey"] as const) {
      expect(shouldHideOverlaysFor(kind, "all", 0, true)).toBe(true);
    }
  });
});

describe("shouldHideOverlaysFor — scrollOnly mode", () => {
  it("hides ONLY for the multi-segment kinds (scroll, perPage)", () => {
    expect(shouldHideOverlaysFor("scroll", "scrollOnly", 0, false)).toBe(true);
    expect(shouldHideOverlaysFor("perPage", "scrollOnly", 0, false)).toBe(true);
    // single-shot kinds: scrollOnly does NOT apply → no hide.
    expect(shouldHideOverlaysFor("visible", "scrollOnly", 0, false)).toBe(false);
    expect(shouldHideOverlaysFor("area", "scrollOnly", 0, false)).toBe(false);
    expect(shouldHideOverlaysFor("click", "scrollOnly", 0, false)).toBe(false);
    expect(shouldHideOverlaysFor("hotkey", "scrollOnly", 0, false)).toBe(false);
  });

  it("respects keepFirstSegment for the multi-segment kinds", () => {
    expect(shouldHideOverlaysFor("scroll", "scrollOnly", 0, true)).toBe(false);
    expect(shouldHideOverlaysFor("scroll", "scrollOnly", 1, true)).toBe(true);
    expect(shouldHideOverlaysFor("perPage", "scrollOnly", 0, true)).toBe(false);
    expect(shouldHideOverlaysFor("perPage", "scrollOnly", 3, true)).toBe(true);
  });
});

describe("parseSelectorList", () => {
  it("returns empty array for empty / whitespace input", () => {
    expect(parseSelectorList("")).toEqual([]);
    expect(parseSelectorList("   ")).toEqual([]);
    expect(parseSelectorList(",,,")).toEqual([]);
  });

  it("splits on comma", () => {
    expect(parseSelectorList(".a, #b, [data-x]")).toEqual([".a", "#b", "[data-x]"]);
  });

  it("splits on newline", () => {
    expect(parseSelectorList(".a\n#b\n[data-x]")).toEqual([".a", "#b", "[data-x]"]);
  });

  it("splits on a mix of commas and newlines", () => {
    expect(parseSelectorList(".a,\n#b\n , [data-x]")).toEqual([".a", "#b", "[data-x]"]);
  });

  it("trims surrounding whitespace from each entry", () => {
    expect(parseSelectorList("  .a  ,  #b  ")).toEqual([".a", "#b"]);
  });
});
