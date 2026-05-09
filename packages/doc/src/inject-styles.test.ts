// @vitest-environment happy-dom
//
// Phase 2 of `docs/plans/annot-html-document.md`. Validates the
// `<style>` payload `injectDocumentStyles` adds to a document:
// canonical bytes, doc-property reflection, and round-trip
// preservation through the parser/serializer pair.

import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "./create-empty.js";
import { buildStyleBlock, injectDocumentStyles } from "./inject-styles.js";
import { parseDocument } from "./parse.js";
import { serializeDocument } from "./serialize.js";

describe("injectDocumentStyles", () => {
  it("returns a new document with styleBlock !== null", () => {
    const before = createEmptyDocument({ title: "Styled" });
    expect(before.styleBlock).toBeNull();
    const after = injectDocumentStyles(before);
    expect(after).not.toBe(before);
    expect(after.styleBlock).not.toBeNull();
    expect(after.styleBlock).toBeTypeOf("string");
    // Untouched fields preserved.
    expect(after.title).toBe(before.title);
    expect(after.lang).toBe(before.lang);
    expect(after.blocks).toBe(before.blocks);
  });

  it("is idempotent (re-running replaces, not appends)", () => {
    const doc = createEmptyDocument({ title: "Idempotent" });
    const once = injectDocumentStyles(doc);
    const twice = injectDocumentStyles(once);
    expect(twice.styleBlock).toBe(once.styleBlock);
  });

  it("emits the canonical font-family stacks for all three logical tokens", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Fonts" }));
    expect(css).toContain('[data-font-family="Annot Sans"]');
    expect(css).toContain('[data-font-family="Annot Serif"]');
    expect(css).toContain('[data-font-family="Annot Mono"]');
  });

  it("emits selectors for every v1 block kind", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Blocks" }));
    expect(css).toContain('[data-annot-block="heading"]');
    expect(css).toContain('[data-annot-block="paragraph"]');
    expect(css).toContain('[data-annot-block="list"]');
    expect(css).toContain('[data-annot-block="code"]');
    expect(css).toContain('[data-annot-block="quote"]');
    expect(css).toContain('[data-annot-block="callout"]');
    expect(css).toContain('[data-annot-block="divider"]');
    expect(css).toContain('[data-annot-block="image"]');
  });

  it("emits all three callout tones", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Tones" }));
    expect(css).toContain('[data-annot-block="callout"][data-tone="info"]');
    expect(css).toContain('[data-annot-block="callout"][data-tone="warn"]');
    expect(css).toContain('[data-annot-block="callout"][data-tone="note"]');
  });

  it("includes a print media block", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Print" }));
    expect(css).toContain("@media print");
    expect(css).toContain("break-inside: avoid");
  });
});

describe("injectDocumentStyles: maxWidth variants", () => {
  const cases: Array<[string, string]> = [
    ["narrow", "600px"],
    ["medium", "720px"],
    ["wide", "960px"],
    ["full", "100%"],
  ];

  for (const [keyword, expected] of cases) {
    it(`maxWidth="${keyword}" → --annot-doc-max-width: ${expected}`, () => {
      const doc = createEmptyDocument({
        title: "Width",
        meta: { maxWidth: keyword as "narrow" | "medium" | "wide" | "full" },
      });
      const css = buildStyleBlock(doc);
      expect(css).toContain(`--annot-doc-max-width: ${expected}`);
    });
  }

  it("defaults to medium (720px) when maxWidth is unset", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Default" }));
    expect(css).toContain("--annot-doc-max-width: 720px");
  });
});

describe("injectDocumentStyles: theme variants", () => {
  it('theme="auto" emits @media (prefers-color-scheme: dark)', () => {
    const doc = createEmptyDocument({ title: "Auto", meta: { theme: "auto" } });
    const css = buildStyleBlock(doc);
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    // Light values are present at top-level :root.
    expect(css).toContain("--annot-doc-bg: #ffffff");
    expect(css).toContain("--annot-doc-fg: #1f2937");
  });

  it('theme="light" omits the prefers-color-scheme branch', () => {
    const doc = createEmptyDocument({ title: "Light", meta: { theme: "light" } });
    const css = buildStyleBlock(doc);
    expect(css).not.toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("--annot-doc-bg: #ffffff");
  });

  it('theme="dark" puts dark values at top + omits the auto-switch branch', () => {
    const doc = createEmptyDocument({ title: "Dark", meta: { theme: "dark" } });
    const css = buildStyleBlock(doc);
    expect(css).not.toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("--annot-doc-bg: #111827");
    expect(css).toContain("--annot-doc-fg: #f9fafb");
    // Light values must NOT also be at top-level for the dark theme.
    expect(css).not.toContain("--annot-doc-bg: #ffffff");
  });

  it("defaults to auto when theme is unset", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Default theme" }));
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });
});

describe("injectDocumentStyles: round-trip", () => {
  it("a styled document survives serialize → parse → serialize byte-identically", () => {
    const styled = injectDocumentStyles(
      createEmptyDocument({
        title: "Round-trip",
        meta: { maxWidth: "wide", theme: "auto" },
      }),
    );
    const onceBytes = serializeDocument(styled);
    const reparsed = parseDocument(onceBytes);
    const twiceBytes = serializeDocument(reparsed);
    expect(twiceBytes).toBe(onceBytes);
    // styleBlock survives the round-trip verbatim.
    expect(reparsed.styleBlock).toBe(styled.styleBlock);
  });

  it("the styled document parses as valid HTML5 (happy-dom)", () => {
    const styled = injectDocumentStyles(createEmptyDocument({ title: "Validity" }));
    const html = serializeDocument(styled);
    // happy-dom would throw on grossly malformed input; reaching
    // this assertion means the document parses cleanly.
    const dom = new DOMParser().parseFromString(html, "text/html");
    expect(dom.querySelector("html")).not.toBeNull();
    expect(dom.querySelector("head > style")).not.toBeNull();
    expect(dom.querySelector("article[data-annot-doc]")).not.toBeNull();
    // No runtime CSS-parse errors visible here, but happy-dom will
    // populate sheet rules — basic smoke check that we got at
    // least one rule in.
    const styleEl = dom.querySelector("style");
    expect(styleEl?.textContent ?? "").toContain("--annot-doc-max-width");
  });
});
