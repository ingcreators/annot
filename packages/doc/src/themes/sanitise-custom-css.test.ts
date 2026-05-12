// Pure Node — no DOM dependency. The sanitiser is regex-only.

import { describe, expect, it } from "vitest";
import {
  CUSTOM_CSS_MAX_BYTES,
  CUSTOM_CSS_TRUNCATION_MARKER,
  sanitiseCustomCss,
  sanitiseCustomCssText,
} from "./sanitise-custom-css.js";

describe("sanitiseCustomCss", () => {
  it("returns the input verbatim when it has no offending constructs", () => {
    const css = "body { background: pink; } h1 { color: red; }";
    const result = sanitiseCustomCss(css);
    expect(result.css).toBe(css);
    expect(result.warnings).toEqual([]);
  });

  it("strips @import rules (with url())", () => {
    const css = '@import url("https://evil.example/track.css"); body { color: red; }';
    const result = sanitiseCustomCss(css);
    expect(result.css).not.toContain("@import");
    expect(result.css).not.toContain("evil.example");
    expect(result.css).toContain("body { color: red; }");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/@import/);
  });

  it("strips @import rules (plain string form)", () => {
    const css = '@import "https://evil.example/track.css"; body { color: red; }';
    const result = sanitiseCustomCss(css);
    expect(result.css).not.toContain("@import");
    expect(result.css).not.toContain("evil.example");
  });

  it("strips external url() references in property values", () => {
    const css = "body { background: url(https://tracker.example/pixel.png); color: red; }";
    const result = sanitiseCustomCss(css);
    expect(result.css).not.toContain("tracker.example");
    expect(result.css).toContain("none");
    expect(result.css).toContain("color: red");
    expect(result.warnings[0]).toMatch(/url/);
  });

  it("strips // protocol-relative urls", () => {
    const css = "body { background: url(//evil.example/track.png); }";
    const result = sanitiseCustomCss(css);
    expect(result.css).not.toContain("evil.example");
  });

  it("allows data: URLs (no network egress)", () => {
    const css = "body { background: url(data:image/png;base64,AAAA); }";
    const result = sanitiseCustomCss(css);
    expect(result.css).toContain("url(data:image/png;base64,AAAA)");
    expect(result.warnings).toEqual([]);
  });

  it("strips behavior: url() legacy IE constructs", () => {
    const css = "body { behavior: url(htc.htc); color: red; }";
    const result = sanitiseCustomCss(css);
    expect(result.css).not.toContain("behavior:");
    expect(result.css).not.toContain("htc.htc");
    expect(result.warnings[0]).toMatch(/behavior/);
  });

  it("truncates input exceeding the 8 KB cap with a trailing marker", () => {
    const big = `body { color: red; ${"/* padding ".repeat(900)} }`;
    expect(big.length).toBeGreaterThan(CUSTOM_CSS_MAX_BYTES);
    const result = sanitiseCustomCss(big);
    expect(result.css.length).toBeLessThanOrEqual(CUSTOM_CSS_MAX_BYTES);
    expect(result.css.endsWith(CUSTOM_CSS_TRUNCATION_MARKER)).toBe(true);
    expect(result.warnings.some((w) => /truncated/i.test(w))).toBe(true);
  });

  it("does not truncate input under the cap", () => {
    const small = "body { color: red; }";
    const result = sanitiseCustomCss(small);
    expect(result.css).toBe(small);
    expect(result.css.endsWith(CUSTOM_CSS_TRUNCATION_MARKER)).toBe(false);
  });

  it("aggregates multiple warnings into the list", () => {
    const css = "@import 'a.css'; body { background: url(http://x); behavior: url(y); }";
    const result = sanitiseCustomCss(css);
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
    expect(result.warnings.some((w) => /@import/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /url/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /behavior/.test(w))).toBe(true);
  });

  it("is idempotent — re-sanitising clean output is a no-op", () => {
    const css = "@import 'x.css'; body { color: red; }";
    const first = sanitiseCustomCss(css);
    const second = sanitiseCustomCss(first.css);
    expect(second.css).toBe(first.css);
    expect(second.warnings).toEqual([]);
  });

  it("returns frozen result for safe sharing", () => {
    const result = sanitiseCustomCss("body { color: red; }");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
  });

  it("handles empty / undefined-like input gracefully", () => {
    expect(sanitiseCustomCss("").css).toBe("");
    expect(sanitiseCustomCss("").warnings).toEqual([]);
    // Defensive: non-string input.
    // biome-ignore lint/suspicious/noExplicitAny: testing runtime-only branch.
    expect(sanitiseCustomCss(null as any).css).toBe("");
  });

  it("sanitiseCustomCssText returns the css string only", () => {
    expect(sanitiseCustomCssText("body { color: red; }")).toBe("body { color: red; }");
    expect(sanitiseCustomCssText("@import 'x'; body {}")).not.toContain("@import");
  });
});
