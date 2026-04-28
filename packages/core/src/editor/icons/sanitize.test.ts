// Phase 3 of `docs/plans/svg-icons-and-plugin-icon-spec.md`.
//
// Allow-list-walker sanitiser test suite. The explicit
// attack-vector table below documents each class of XSS we
// guard against; any future change to `sanitize.ts` MUST keep
// these passing — that's the security contract for plugin-
// supplied SVG.

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { sanitizeIconSvg } from "./sanitize.js";

describe("sanitizeIconSvg — accepts well-formed icons", () => {
  it("round-trips a plain <svg>/<path>", () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
    const out = sanitizeIconSvg(input);
    expect(out).toContain("<svg");
    expect(out).toContain('viewBox="0 0 24 24"');
    expect(out).toContain('d="M0 0h24v24H0z"');
  });

  it("preserves currentColor + aria-hidden", () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M0 0h24v24H0z"/></svg>';
    const out = sanitizeIconSvg(input);
    expect(out).toContain('fill="currentColor"');
    expect(out).toContain('aria-hidden="true"');
  });

  it("preserves nested <g> / <defs> / <linearGradient>", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<defs><linearGradient id="g1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs>' +
      '<g><path d="M0 0h24v24H0z" fill="url(#g1)"/></g>' +
      "</svg>";
    const out = sanitizeIconSvg(input);
    expect(out).toContain("<defs");
    expect(out).toContain("<linearGradient");
    expect(out).toContain("<stop");
    expect(out).toContain('fill="url(#g1)"');
  });

  it("preserves <use href> when it points at an internal fragment", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<defs><path id="ic" d="M0 0h24v24H0z"/></defs>' +
      '<use href="#ic"/>' +
      "</svg>";
    const out = sanitizeIconSvg(input);
    expect(out).toContain('href="#ic"');
  });

  it("returns null for empty / non-string / oversized inputs", () => {
    expect(sanitizeIconSvg("")).toBeNull();
    expect(sanitizeIconSvg("not an svg")).toBeNull();
    expect(sanitizeIconSvg("<div>not svg</div>")).toBeNull();
    const huge = "<svg>" + "x".repeat(100_000) + "</svg>";
    expect(sanitizeIconSvg(huge)).toBeNull();
  });
});

describe("sanitizeIconSvg — attack vectors", () => {
  it("strips inline <script>", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0"/></svg>';
    const out = sanitizeIconSvg(input);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert");
  });

  it("strips on* event-handler attributes", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0" onclick="alert(2)"/></svg>';
    const out = sanitizeIconSvg(input);
    expect(out).not.toContain("onload");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("alert");
  });

  it("rejects javascript: in <use href>", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="javascript:alert(1)"/></svg>';
    const out = sanitizeIconSvg(input);
    expect(out ?? "").not.toContain("javascript:");
  });

  it("rejects external https:// in <use href>", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.test/sprite#x"/></svg>';
    const out = sanitizeIconSvg(input);
    expect(out ?? "").not.toContain("https://evil.test");
  });

  it("rejects external href on <image> (element banned outright)", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/x.png" width="10" height="10"/></svg>';
    const out = sanitizeIconSvg(input);
    expect(out ?? "").not.toContain("<image");
    expect(out ?? "").not.toContain("evil.test");
  });

  it("strips <foreignObject> (HTML escape hatch)", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">malicious</div></foreignObject></svg>';
    const out = sanitizeIconSvg(input);
    expect(out ?? "").not.toContain("foreignObject");
    expect(out ?? "").not.toContain("malicious");
  });

  it("strips <style> elements + style= attributes", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg"><style>* { background: url(javascript:alert(1)); }</style><path d="M0 0" style="fill: red"/></svg>';
    const out = sanitizeIconSvg(input);
    expect(out ?? "").not.toContain("<style");
    expect(out ?? "").not.toContain("javascript:");
    expect(out ?? "").not.toContain('style=');
  });

  it("rejects <a> element entirely (not in allow-list)", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>';
    const out = sanitizeIconSvg(input);
    expect(out ?? "").not.toContain("<a ");
    expect(out ?? "").not.toContain("javascript:");
  });

  it("does not preserve attributes from outside the allow-list", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" data-evil="x" formaction="javascript:alert(1)"><path d="M0 0"/></svg>';
    const out = sanitizeIconSvg(input);
    expect(out ?? "").not.toContain("data-evil");
    expect(out ?? "").not.toContain("formaction");
  });
});
