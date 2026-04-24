import { describe, expect, it } from "vitest";
import { DASH_MULTIPLIERS, computeDasharray, detectDashKey } from "./dash-utils.js";

describe("DASH_MULTIPLIERS", () => {
  it("exposes the Office dash presets", () => {
    expect(Object.keys(DASH_MULTIPLIERS).sort()).toEqual(["dash", "dashDot", "dot", "lgDash"]);
  });
});

describe("computeDasharray", () => {
  it("returns the empty string for unknown keys", () => {
    expect(computeDasharray("unknown", 2)).toBe("");
  });

  it("scales the multiplier by the stroke width and rounds to at least 1", () => {
    // "dash" = [4, 3] at sw=2 → [8, 6]
    expect(computeDasharray("dash", 2)).toBe("8,6");
    // "dot" = [1, 3] at sw=0.25 would round below 1 but is clamped.
    expect(computeDasharray("dot", 0.25)).toBe("1,1");
  });

  it("handles stroke width 1", () => {
    expect(computeDasharray("dash", 1)).toBe("4,3");
    expect(computeDasharray("dot", 1)).toBe("1,3");
    expect(computeDasharray("dashDot", 1)).toBe("4,3,1,3");
    expect(computeDasharray("lgDash", 1)).toBe("8,3");
  });

  it("rounds fractional multiplier results", () => {
    // "dash" = [4, 3] at sw=1.5 → [6, 4.5] → [6, 5]
    expect(computeDasharray("dash", 1.5)).toBe("6,5");
  });
});

describe("detectDashKey", () => {
  it("returns the empty string for an empty dasharray", () => {
    expect(detectDashKey("", 2)).toBe("");
  });

  it("round-trips with computeDasharray for each known key", () => {
    for (const key of Object.keys(DASH_MULTIPLIERS)) {
      for (const sw of [1, 1.5, 2, 4]) {
        const s = computeDasharray(key, sw);
        expect(detectDashKey(s, sw)).toBe(key);
      }
    }
  });

  it("applies the 4-part heuristic to identify dashDot even when numbers don't match", () => {
    expect(detectDashKey("5,3,2,3", 1)).toBe("dashDot");
  });

  it("applies the 2-part heuristic — short leading segment → dot", () => {
    // sw=4, so sw*2 = 8. leading=2 <= 8, qualifies as dot.
    expect(detectDashKey("2,10", 4)).toBe("dot");
  });

  it("applies the 2-part heuristic — long leading segment → lgDash", () => {
    // sw=1, so sw*5 = 5. leading=20 > 5, qualifies as lgDash.
    expect(detectDashKey("20,5", 1)).toBe("lgDash");
  });

  it("falls back to dash when nothing more specific matches", () => {
    // Leading segment 3 at sw=1 is in the "middling" zone
    // (sw*2 < 3 <= sw*5), where neither the dot nor the lgDash
    // heuristic triggers.
    expect(detectDashKey("3,2", 1)).toBe("dash");
  });
});
