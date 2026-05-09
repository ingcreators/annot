import { describe, expect, it } from "vitest";
import { translatePathD } from "./path-utils.js";

describe("translatePathD", () => {
  it("returns input unchanged when dx=dy=0", () => {
    const d = "M 10 20 L 30 40 Z";
    expect(translatePathD(d, 0, 0)).toBe(d);
  });

  it("shifts a single absolute moveto", () => {
    expect(translatePathD("M 10 20", 5, 7)).toBe("M15 27");
  });

  it("shifts absolute M + L sequence", () => {
    expect(translatePathD("M 10 20 L 30 40", 5, 7)).toBe("M15 27 L35 47");
  });

  it("treats implicit L continuation after M as L", () => {
    // `M 10 20 30 40` = M(10,20) then implicit L(30,40)
    expect(translatePathD("M 10 20 30 40", 5, 7)).toBe("M15 27 35 47");
  });

  it("leaves relative commands untouched", () => {
    // Lowercase l = relative — deltas don't change under translation
    expect(translatePathD("M 10 20 l 5 5", 100, 100)).toBe("M110 120 l5 5");
  });

  it("treats leading lowercase m as absolute for first pair only", () => {
    // Per SVG spec: leading `m` is absolute moveto for first x,y;
    // subsequent pairs in the same token are relative `l`.
    expect(translatePathD("m 10 20 30 40", 5, 7)).toBe("m15 27 30 40");
  });

  it("handles H (horizontal) — only x affected", () => {
    expect(translatePathD("M 10 20 H 100", 5, 7)).toBe("M15 27 H105");
  });

  it("handles V (vertical) — only y affected", () => {
    expect(translatePathD("M 10 20 V 200", 5, 7)).toBe("M15 27 V207");
  });

  it("handles relative h / v as no-ops", () => {
    expect(translatePathD("M 10 20 h 50 v 30", 5, 7)).toBe("M15 27 h50 v30");
  });

  it("handles cubic Bézier C — every coord pair shifted", () => {
    // Three pairs per repeat: control1, control2, end
    expect(translatePathD("M 0 0 C 10 0 20 10 30 20", 5, 7)).toBe("M5 7 C15 7 25 17 35 27");
  });

  it("handles smooth cubic S", () => {
    expect(translatePathD("M 0 0 S 20 10 30 20", 5, 7)).toBe("M5 7 S25 17 35 27");
  });

  it("handles quadratic Q", () => {
    expect(translatePathD("M 0 0 Q 10 10 20 0", 5, 7)).toBe("M5 7 Q15 17 25 7");
  });

  it("handles smooth quadratic T", () => {
    expect(translatePathD("M 0 0 Q 10 10 20 0 T 40 0", 5, 7)).toBe("M5 7 Q15 17 25 7 T45 7");
  });

  it("handles arc A — only the final x,y are coords", () => {
    // A rx ry x-axis-rotation large-arc-flag sweep-flag x y
    // rx, ry, rotation, flags must NOT be shifted.
    expect(translatePathD("M 10 10 A 30 30 0 0 1 50 50", 5, 7)).toBe("M15 17 A30 30 0 0 1 55 57");
  });

  it("handles Z / z as no-ops", () => {
    expect(translatePathD("M 10 20 L 30 40 Z", 5, 7)).toBe("M15 27 L35 47 Z");
  });

  it("preserves exponent notation in input numbers", () => {
    expect(translatePathD("M 1e2 2e1", 5, 7)).toBe("M105 27");
  });

  it("handles negative shifts", () => {
    expect(translatePathD("M 100 200 L 300 400", -50, -100)).toBe("M50 100 L250 300");
  });

  it("handles signed numbers in input (no separator before -)", () => {
    // SVG path numbers can use `-` as a separator: "10-20" = [10, -20]
    expect(translatePathD("M10-20L30-40", 5, 7)).toBe("M15 -13 L35 -33");
  });

  it("handles comma-separated numbers", () => {
    expect(translatePathD("M10,20 L30,40", 5, 7)).toBe("M15 27 L35 47");
  });

  it("handles decimal-only numbers (no leading 0)", () => {
    expect(translatePathD("M.5 .25", 5, 7)).toBe("M5.5 7.25");
  });

  it("round-trips: shift then unshift returns same coords (canonicalised)", () => {
    const original = "M 10 20 L 30 40 C 50 60 70 80 90 100 Z";
    const shifted = translatePathD(original, 5, 7);
    const unshifted = translatePathD(shifted, -5, -7);
    // The original includes inter-token spaces that the serializer
    // doesn't emit; re-shift the original by zero in two halves so
    // it goes through the serializer too. We can't use (0,0) because
    // that's an early-return short-circuit by design. Use ±0.0001
    // and back to force serializer round-trip without changing values.
    const canonOriginal = translatePathD(translatePathD(original, 1e-12, 1e-12), -1e-12, -1e-12);
    expect(unshifted).toBe(canonOriginal);
  });

  it("handles a complex mixed path (Annot freehand-style)", () => {
    // Real-world input: M absolute, multiple Q smoothing, Z close
    const d = "M 50 50 Q 60 40 70 50 Q 80 60 90 50 L 100 50 Z";
    expect(translatePathD(d, 10, 20)).toBe("M60 70 Q70 60 80 70 Q90 80 100 70 L110 70 Z");
  });

  it("formats trailing zeros away (10.000 → 10)", () => {
    // dx=5 added to 10.0 gives 15.0; output should be "15", not "15.0"
    expect(translatePathD("M 10.0 20.0", 5, 7)).toBe("M15 27");
  });

  it("caps fractional precision at 6 digits", () => {
    expect(translatePathD("M 10 20", 0.1234567890123, 0)).toBe("M10.123457 20");
  });

  it("treats subpath continuations (multiple M tokens) consistently", () => {
    // Second M starts a new subpath — both should shift
    expect(translatePathD("M 10 20 L 30 40 M 50 60 L 70 80", 5, 7)).toBe(
      "M15 27 L35 47 M55 67 L75 87",
    );
  });

  it("treats subpath continuations starting with lowercase m as relative", () => {
    // Only the FIRST command of the path can be the leading-m quirk.
    // A second `m` mid-path is a normal relative moveto.
    expect(translatePathD("M 10 20 L 30 40 m 50 60", 5, 7)).toBe("M15 27 L35 47 m50 60");
  });
});
