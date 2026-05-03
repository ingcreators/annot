import { describe, expect, it } from "vitest";
import {
  coerceToLogicalFamily,
  cssStackFor,
  isLogicalFamily,
  LOGICAL_FAMILIES,
  ooxmlTypefacesFor,
} from "./font-registry.js";

describe("LOGICAL_FAMILIES", () => {
  it("ships exactly three tokens", () => {
    expect(LOGICAL_FAMILIES).toHaveLength(3);
  });

  it("includes Sans / Serif / Mono", () => {
    expect(LOGICAL_FAMILIES).toContain("Annot Sans");
    expect(LOGICAL_FAMILIES).toContain("Annot Serif");
    expect(LOGICAL_FAMILIES).toContain("Annot Mono");
  });
});

describe("cssStackFor", () => {
  it("returns a stack for each logical family", () => {
    for (const f of LOGICAL_FAMILIES) {
      const stack = cssStackFor(f);
      expect(stack.length).toBeGreaterThan(0);
    }
  });

  it("Sans stack interleaves Latin + CJK + complex script + generic", () => {
    const stack = cssStackFor("Annot Sans");
    // Latin
    expect(stack).toContain("Segoe UI");
    expect(stack).toContain("-apple-system");
    // CJK — Japanese / Chinese / Korean OS sans
    expect(stack).toContain("Hiragino Sans");
    expect(stack).toContain("Yu Gothic UI");
    expect(stack).toContain("PingFang SC");
    expect(stack).toContain("Malgun Gothic");
    // Complex script families
    expect(stack).toContain("Nirmala UI");
    expect(stack).toContain("Tahoma");
    // Generic terminator + emoji
    expect(stack).toMatch(/sans-serif/);
    expect(stack).toContain("Apple Color Emoji");
  });

  it("Serif stack ends with serif generic", () => {
    const stack = cssStackFor("Annot Serif");
    expect(stack).toContain("Cambria");
    expect(stack).toContain("Yu Mincho");
    expect(stack).toMatch(/serif$/);
  });

  it("Mono stack ends with monospace generic", () => {
    const stack = cssStackFor("Annot Mono");
    expect(stack).toContain("Consolas");
    expect(stack).toContain("Menlo");
    expect(stack).toMatch(/monospace$/);
  });

  it("Latin families come BEFORE CJK in the Sans stack", () => {
    // Stack order matters for mixed-script content: Latin glyphs
    // should NOT come from a CJK Latin variant (e.g. Yu Gothic
    // Latin), they should land on Helvetica / Segoe UI etc.
    const stack = cssStackFor("Annot Sans");
    const latinIdx = stack.indexOf("Segoe UI");
    const cjkIdx = stack.indexOf("Hiragino Sans");
    expect(latinIdx).toBeGreaterThan(-1);
    expect(cjkIdx).toBeGreaterThan(-1);
    expect(latinIdx).toBeLessThan(cjkIdx);
  });
});

describe("ooxmlTypefacesFor", () => {
  it("returns latin / ea / cs typefaces for each logical family", () => {
    for (const f of LOGICAL_FAMILIES) {
      const t = ooxmlTypefacesFor(f);
      expect(t.latin.length).toBeGreaterThan(0);
      expect(t.ea.length).toBeGreaterThan(0);
      expect(t.cs.length).toBeGreaterThan(0);
    }
  });

  it("Sans → Calibri / Yu Gothic UI / Arial", () => {
    const t = ooxmlTypefacesFor("Annot Sans");
    expect(t.latin).toBe("Calibri");
    expect(t.ea).toBe("Yu Gothic UI");
    expect(t.cs).toBe("Arial");
  });

  it("Serif → Cambria / Yu Mincho / Times New Roman", () => {
    const t = ooxmlTypefacesFor("Annot Serif");
    expect(t.latin).toBe("Cambria");
    expect(t.ea).toBe("Yu Mincho");
    expect(t.cs).toBe("Times New Roman");
  });

  it("Mono → Consolas / MS Gothic / Courier New", () => {
    const t = ooxmlTypefacesFor("Annot Mono");
    expect(t.latin).toBe("Consolas");
    expect(t.ea).toBe("MS Gothic");
    expect(t.cs).toBe("Courier New");
  });
});

describe("isLogicalFamily", () => {
  it("recognises every logical token", () => {
    for (const f of LOGICAL_FAMILIES) expect(isLogicalFamily(f)).toBe(true);
  });

  it("rejects raw CSS family names", () => {
    expect(isLogicalFamily("sans-serif")).toBe(false);
    expect(isLogicalFamily("Hiragino Sans")).toBe(false);
    expect(isLogicalFamily("Arial, sans-serif")).toBe(false);
  });

  it("rejects null / undefined / empty", () => {
    expect(isLogicalFamily(null)).toBe(false);
    expect(isLogicalFamily(undefined)).toBe(false);
    expect(isLogicalFamily("")).toBe(false);
  });
});

describe("coerceToLogicalFamily", () => {
  it("identity for known tokens", () => {
    for (const f of LOGICAL_FAMILIES) expect(coerceToLogicalFamily(f)).toBe(f);
  });

  it("unknown raw family → Annot Sans", () => {
    expect(coerceToLogicalFamily("sans-serif")).toBe("Annot Sans");
    expect(coerceToLogicalFamily("Hiragino Sans")).toBe("Annot Sans");
    expect(coerceToLogicalFamily("Arial, sans-serif")).toBe("Annot Sans");
  });

  it("null / undefined / empty → Annot Sans", () => {
    expect(coerceToLogicalFamily(null)).toBe("Annot Sans");
    expect(coerceToLogicalFamily(undefined)).toBe("Annot Sans");
    expect(coerceToLogicalFamily("")).toBe("Annot Sans");
  });
});
