// Phase 3 of `docs/plans/svg-icons-and-plugin-icon-spec.md`.
//
// `renderIconHtml` dispatches on the IconSpec kind and produces
// the markup string consumed by Lit `unsafeHTML` /
// `<annot-icon>`.

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { builtinIcon, svgIcon, urlIcon } from "../../icons/types.js";
import { BUILTIN_ICON_IDS } from "./registry.js";
import { renderIconHtml } from "./render.js";

describe("renderIconHtml — builtin", () => {
  it("returns the registered SVG for a known id", () => {
    const out = renderIconHtml(builtinIcon("edit"));
    expect(out).toContain("<svg");
    expect(out).toContain("</svg>");
    expect(out).toContain("currentColor");
  });

  it("returns empty string for an unknown id", () => {
    const out = renderIconHtml(builtinIcon("definitely-not-a-real-id"));
    expect(out).toBe("");
  });

  it("every registered builtin id renders to non-empty <svg>", () => {
    for (const id of BUILTIN_ICON_IDS) {
      const out = renderIconHtml(builtinIcon(id));
      expect(out, `empty render for ${id}`).toContain("<svg");
    }
  });
});

describe("renderIconHtml — svg", () => {
  it("returns sanitised markup for valid plugin SVG", () => {
    const out = renderIconHtml(
      svgIcon('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z"/></svg>'),
    );
    expect(out).toContain("<svg");
    expect(out).toContain("M0 0h24v24H0z");
  });

  it("returns empty string for unparseable input", () => {
    expect(renderIconHtml(svgIcon(""))).toBe("");
    expect(renderIconHtml(svgIcon("<div>not svg</div>"))).toBe("");
  });

  it("returns empty string for input that survives sanitisation as something we'd refuse", () => {
    // Plain text that isn't an <svg> root.
    expect(renderIconHtml(svgIcon('<path d="M0 0"/>'))).toBe("");
  });
});

describe("renderIconHtml — url", () => {
  it("renders <img src=…> for a same-origin path", () => {
    const out = renderIconHtml(urlIcon("/icons/foo.svg"));
    expect(out).toContain("<img");
    expect(out).toContain('src="/icons/foo.svg"');
    expect(out).toContain('aria-hidden="true"');
  });

  it("renders <img src=…> for a data:image/svg+xml URL", () => {
    const out = renderIconHtml(urlIcon("data:image/svg+xml,%3Csvg/%3E"));
    expect(out).toContain("<img");
    expect(out).toContain('src="data:image/svg+xml,%3Csvg/%3E"');
  });

  it("rejects external https:// URLs", () => {
    expect(renderIconHtml(urlIcon("https://evil.test/x.svg"))).toBe("");
  });

  it("rejects javascript: URLs", () => {
    expect(renderIconHtml(urlIcon("javascript:alert(1)"))).toBe("");
  });

  it("rejects data: URLs that aren't image/svg+xml", () => {
    expect(renderIconHtml(urlIcon("data:text/html,<script>alert(1)</script>"))).toBe("");
  });

  it("escapes ampersand / quote / less-than in the URL attribute", () => {
    const out = renderIconHtml(urlIcon('/icons/foo&bar"baz<.svg'));
    expect(out).toContain("&amp;");
    expect(out).toContain("&quot;");
    expect(out).toContain("&lt;");
    expect(out).not.toContain('"baz<');
  });
});
