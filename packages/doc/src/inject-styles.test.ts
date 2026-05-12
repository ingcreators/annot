// @vitest-environment happy-dom
//
// Phase 2 of `docs/plans/_done/annot-html-document.md`. Validates the
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

  it("scales image SVGs with `max-width: 100%` (not `width: 100%`)", () => {
    // `width: 100%` stretched a 320px-wide capture out to fill
    // the column; the in-app view doesn't do that. `max-width`
    // keeps the natural pixel size as the upper bound. See the
    // .annot.html standalone-view bug fix.
    const css = buildStyleBlock(createEmptyDocument({ title: "Images" }));
    expect(css).toContain('[data-annot-block="image"] svg {\n  max-width: 100%;');
    expect(css).not.toMatch(/\[data-annot-block="image"\] svg \{\s*width: 100%;/);
  });

  it("includes the standalone-view TOC chrome", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "TOC chrome" }));
    expect(css).toContain("nav[data-annot-toc]");
    expect(css).toContain("data-annot-toc-title");
    expect(css).toContain('nav[data-annot-toc] li[data-annot-toc-level="2"]');
    expect(css).toContain('nav[data-annot-toc] li[data-annot-toc-level="3"]');
    // TOC stays out of paginated print output. Verify the
    // `display: none` rule sits inside the `@media print` block
    // by isolating the print payload and probing it. (Greedy
    // `.*` regex doesn't work — the @media block contains
    // multiple `}` from inner rules.)
    const printIdx = css.indexOf("@media print {");
    expect(printIdx).toBeGreaterThan(-1);
    const printPayload = css.slice(printIdx);
    expect(printPayload).toContain("nav[data-annot-toc] {\n    display: none;");
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

describe("injectDocumentStyles: numbering meta (Phase 13)", () => {
  it("emits no counter rules when numbering is absent", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "No numbering" }));
    expect(css).not.toContain("counter-increment");
    expect(css).not.toContain("counter-reset");
    expect(css).not.toContain("annot-h1");
    expect(css).not.toContain("annot-figure");
  });

  it("emits no counter rules when numbering is set but everything is false", () => {
    const css = buildStyleBlock(
      createEmptyDocument({
        title: "Disabled",
        meta: { numbering: { headings: false, figures: false } },
      }),
    );
    expect(css).not.toContain("counter-increment");
    expect(css).not.toContain("annot-h1");
    expect(css).not.toContain("annot-figure");
  });

  it("emits heading-counter rules when numbering.headings is true", () => {
    const css = buildStyleBlock(
      createEmptyDocument({
        title: "Numbered headings",
        meta: { numbering: { headings: true } },
      }),
    );
    // Counter resets on the article element.
    expect(css).toContain("counter-reset: annot-h1 annot-h2 annot-h3");
    // Each level gets ::before with counter-increment + content.
    expect(css).toContain('[data-annot-block="heading"][data-level="1"]::before');
    expect(css).toContain('[data-annot-block="heading"][data-level="2"]::before');
    expect(css).toContain('[data-annot-block="heading"][data-level="3"]::before');
    expect(css).toContain("counter-increment: annot-h1");
    expect(css).toContain("counter-increment: annot-h2");
    expect(css).toContain("counter-increment: annot-h3");
    // No figure-counter rules when figures is off.
    expect(css).not.toContain("annot-figure");
  });

  it("emits figure-counter rules when numbering.figures is true", () => {
    const css = buildStyleBlock(
      createEmptyDocument({
        title: "Numbered figures",
        meta: { numbering: { figures: true } },
      }),
    );
    expect(css).toContain("counter-reset: annot-figure");
    expect(css).toContain('[data-annot-block="image"]');
    expect(css).toContain("counter-increment: annot-figure");
    expect(css).toContain("figcaption::before");
    // Default label.
    expect(css).toContain('"Figure "');
    // No heading-counter rules when headings is off.
    expect(css).not.toContain("annot-h1");
  });

  it("emits both heading and figure counters when both flags are on", () => {
    const css = buildStyleBlock(
      createEmptyDocument({
        title: "Both",
        meta: { numbering: { headings: true, figures: true } },
      }),
    );
    expect(css).toContain("counter-reset: annot-h1 annot-h2 annot-h3 annot-figure");
    expect(css).toContain("counter-increment: annot-h1");
    expect(css).toContain("counter-increment: annot-figure");
  });

  it("uses the user-supplied figureLabel verbatim", () => {
    const css = buildStyleBlock(
      createEmptyDocument({
        title: "Localised label",
        meta: { numbering: { figures: true, figureLabel: "図 " } },
      }),
    );
    expect(css).toContain('"図 "');
    expect(css).not.toContain('"Figure "');
  });

  it("survives a parse → serialize round-trip with numbering set", () => {
    const original = injectDocumentStyles(
      createEmptyDocument({
        title: "Round-trip numbered",
        meta: { numbering: { headings: true, figures: true, figureLabel: "図 " } },
      }),
    );
    const onceBytes = serializeDocument(original);
    const reparsed = parseDocument(onceBytes);
    const twiceBytes = serializeDocument(reparsed);
    expect(twiceBytes).toBe(onceBytes);
    // The reparsed document should carry the numbering field.
    expect(reparsed.meta.numbering).toEqual({
      headings: true,
      figures: true,
      figureLabel: "図 ",
    });
  });

  // Phase 1 of `docs/plans/card-step-auto-numbering.md` — the
  // `steps` + `stepLabel` data-layer additions. Phase 1
  // deliberately stops short of emitting any CSS for the new
  // fields (Phase 2 lights up the counter + badge); these tests
  // exercise round-trip preservation only.
  it("preserves numbering.steps through parse → serialize round-trip", () => {
    const original = createEmptyDocument({
      title: "Round-trip stepped",
      meta: { numbering: { steps: true } },
    });
    const onceBytes = serializeDocument(original);
    const reparsed = parseDocument(onceBytes);
    const twiceBytes = serializeDocument(reparsed);
    expect(twiceBytes).toBe(onceBytes);
    expect(reparsed.meta.numbering).toEqual({ steps: true });
  });

  it("preserves numbering.stepLabel through parse → serialize round-trip", () => {
    const original = createEmptyDocument({
      title: "Round-trip step label",
      meta: { numbering: { steps: true, stepLabel: "Step %n" } },
    });
    const onceBytes = serializeDocument(original);
    const reparsed = parseDocument(onceBytes);
    const twiceBytes = serializeDocument(reparsed);
    expect(twiceBytes).toBe(onceBytes);
    expect(reparsed.meta.numbering).toEqual({
      steps: true,
      stepLabel: "Step %n",
    });
  });

  it("parses numbering with steps alongside headings + figures", () => {
    const original = createEmptyDocument({
      title: "All three",
      meta: {
        numbering: {
          headings: true,
          figures: true,
          figureLabel: "図 ",
          steps: true,
          stepLabel: "%n",
        },
      },
    });
    const reparsed = parseDocument(serializeDocument(original));
    expect(reparsed.meta.numbering).toEqual({
      headings: true,
      figures: true,
      figureLabel: "図 ",
      steps: true,
      stepLabel: "%n",
    });
  });

  it("Phase 1 emits no step-counter CSS yet (Phase 2 lights it up)", () => {
    // Defensive guard: Phase 1 is data-layer only. If a future
    // edit accidentally emits CSS for `numbering.steps` without
    // updating Phase 2's plan section, this test fails first.
    const css = buildStyleBlock(
      createEmptyDocument({
        title: "Phase 1 no CSS",
        meta: { numbering: { steps: true, stepLabel: "Step %n" } },
      }),
    );
    expect(css).not.toContain("annot-step");
  });

  it("dropping `numbering: {}` from a parsed sidecar treats it as absent", () => {
    // Defensive: a hand-edited sidecar that explicitly sets
    // `"numbering": {}` should round-trip as if the field were
    // unset (the parser elides the empty-object form).
    const html = serializeDocument(
      createEmptyDocument({
        title: "Empty numbering",
        meta: {},
      }),
    );
    // Inject `"numbering":{}` into the JSON sidecar.
    const tampered = html.replace(
      /\{"title":"Empty numbering"\}/,
      '{"numbering":{},"title":"Empty numbering"}',
    );
    expect(tampered).not.toBe(html); // sanity-check the replace landed
    const reparsed = parseDocument(tampered);
    expect(reparsed.meta.numbering).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 2 of docs/plans/_done/card-procedure-template.md — step block
// card chrome + per-layout grid templates + cardLayout meta.
// ---------------------------------------------------------------------------

describe("injectDocumentStyles: step block card chrome", () => {
  it("emits the card chrome rule with all five chrome properties", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Card chrome" }));
    expect(css).toContain('[data-annot-block="step"] {');
    expect(css).toContain("background: var(--annot-card-bg)");
    expect(css).toContain("border: var(--annot-card-border)");
    expect(css).toContain("border-radius: var(--annot-card-radius)");
    expect(css).toContain("box-shadow: var(--annot-card-shadow)");
    expect(css).toContain("padding: var(--annot-card-padding)");
  });

  it("emits non-themed card sizing variables in :root", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Card sizing" }));
    expect(css).toContain("--annot-card-radius: 8px");
    expect(css).toContain("--annot-card-padding: 1rem");
    expect(css).toContain("--annot-card-gap: 1.5rem");
  });

  it("emits themed card chrome variables in light theme", () => {
    const css = buildStyleBlock(
      createEmptyDocument({ title: "Light card", meta: { theme: "light" } }),
    );
    expect(css).toContain("--annot-card-bg: #ffffff");
    expect(css).toContain("--annot-card-border: 1px solid #e5e7eb");
    expect(css).toContain("--annot-card-shadow:");
  });

  it("emits themed card chrome variables in dark theme", () => {
    const css = buildStyleBlock(
      createEmptyDocument({ title: "Dark card", meta: { theme: "dark" } }),
    );
    expect(css).toContain("--annot-card-bg: #1f2937");
    expect(css).toContain("--annot-card-border: 1px solid #374151");
  });

  it("auto theme includes dark card overrides inside @media (prefers-color-scheme: dark)", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Auto card" }));
    const darkBlock = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    expect(darkBlock).toContain("--annot-card-bg: #1f2937");
    expect(darkBlock).toContain("--annot-card-border: 1px solid #374151");
  });
});

describe("injectDocumentStyles: step block layouts", () => {
  it("emits a grid template for each of the five data-step-layout values", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Layouts" }));
    // image-top is the default — covered by `:not([data-step-layout])`
    // plus the explicit attribute selector.
    expect(css).toContain('[data-annot-block="step"]:not([data-step-layout]),');
    expect(css).toContain('[data-annot-block="step"][data-step-layout="image-top"] {');
    expect(css).toContain('[data-annot-block="step"][data-step-layout="image-bottom"] {');
    expect(css).toContain('[data-annot-block="step"][data-step-layout="image-left"] {');
    expect(css).toContain('[data-annot-block="step"][data-step-layout="image-right"] {');
    expect(css).toContain('[data-annot-block="step"][data-step-layout="image-fill"] {');
  });

  it("the four area-based layouts use grid-template-areas with image / title / body slots", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Areas" }));
    // Each of the four named-area layouts mentions all three slots.
    // image-top / image-bottom emit single-column areas (`"image"`,
    // `"title"`, `"body"`); image-left / image-right emit two-column
    // areas (`"image title"`, `"image body"` and the mirror).
    // The assertion just checks each slot name shows up at least
    // once in the rule body.
    for (const layout of ["image-top", "image-bottom", "image-left", "image-right"]) {
      const sectionStart = css.indexOf(`[data-annot-block="step"][data-step-layout="${layout}"] {`);
      expect(sectionStart).toBeGreaterThan(-1);
      // Grab a slice covering the rule body (next "}" terminates).
      const sectionEnd = css.indexOf("}", sectionStart);
      const section = css.slice(sectionStart, sectionEnd);
      expect(section).toContain("display: grid");
      expect(section).toContain("grid-template-areas:");
      expect(section).toMatch(/image/);
      expect(section).toMatch(/title/);
      expect(section).toMatch(/body/);
    }
  });

  it("image-fill uses absolute positioning instead of grid", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Fill" }));
    const start = css.indexOf('[data-annot-block="step"][data-step-layout="image-fill"] {');
    expect(start).toBeGreaterThan(-1);
    const end = css.indexOf("}", start);
    const section = css.slice(start, end);
    expect(section).toContain("display: block");
    // `position: relative` lives on the shared step rule
    // (Phase 3b moved it there so the in-block layout
    // switcher can anchor against every layout, not just
    // image-fill). The image-fill section relies on it
    // implicitly.
    const sharedStart = css.indexOf('[data-annot-block="step"] {');
    expect(sharedStart).toBeGreaterThan(-1);
    const sharedEnd = css.indexOf("}", sharedStart);
    expect(css.slice(sharedStart, sharedEnd)).toContain("position: relative");
  });

  it("child slots get grid-area assignments at the default selector level", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Slots" }));
    // Image grid-area applies to both the direct SVG (standalone
    // view) and the editor's `.annot-doc-image-svg-slot` wrapper
    // — the rule is a comma-list so both selectors share the
    // declarations.
    expect(css).toContain('[data-annot-block="step"] > svg,');
    expect(css).toContain('[data-annot-block="step"] > .annot-doc-image-svg-slot {');
    expect(css).toContain("grid-area: image");
    expect(css).toContain('[data-annot-block="step"] > [data-step-title] {');
    expect(css).toContain("grid-area: title");
    expect(css).toContain('[data-annot-block="step"] > [data-step-body] {');
    expect(css).toContain("grid-area: body");
  });

  it("card image slot uses a fixed 16:9 aspect ratio (Phase 7d-polish)", () => {
    // Phase 7d-polish: the card image area is locked to 16:9
    // regardless of the source bitmap's aspect ratio, so cards
    // in a multi-column grid have uniform height and the editor
    // preview matches the PPTX slide canvas. Non-16:9 sources
    // letterbox inside the frame via the SVG's default
    // `preserveAspectRatio="xMidYMid meet"`.
    const css = buildStyleBlock(createEmptyDocument({ title: "Slot SVG" }));
    expect(css).toContain('[data-annot-block="step"] > .annot-doc-image-svg-slot {');
    expect(css).toContain("aspect-ratio: 16 / 9");
    expect(css).toContain("overflow: hidden");
    // The inner SVG fills the slot's 16:9 box on both axes.
    expect(css).toContain('[data-annot-block="step"] .annot-doc-image-svg-slot > svg {');
    expect(css).toContain("width: 100%");
    expect(css).toContain("height: 100%");
  });

  it("card image inner SVG does NOT use position:absolute (regresses card grid sizing)", () => {
    // #618 originally added `position: absolute; inset: 0` on
    // the slot's inner SVG plus `position: relative` on the
    // slot itself as a defence against any node ending up above
    // the SVG inside the slot. User-reported regression: with
    // the SVG out of flow the slot has no in-flow children, and
    // browsers' grid track sizing (the card is `display: grid;
    // grid-template-columns: 1fr` with aspect-ratio-bearing
    // items) shrinks the track to the toolbar's min-content
    // width, leaving documents stuck at a narrow card column
    // regardless of `--annot-doc-max-width`. Reverting to in-
    // flow SVG restores the column width; the grey strip is
    // already covered by the editor-side id strip, the
    // `margin: 0` host guard, the JS non-SVG-child peel, and
    // the `<?xml ?>` regex strip — `position: absolute` was
    // extra belt-and-braces that turned out to break a more
    // important contract.
    const css = buildStyleBlock(createEmptyDocument({ title: "Slot anchor" }));
    const slotStart = css.indexOf('[data-annot-block="step"] > .annot-doc-image-svg-slot {');
    const slotEnd = css.indexOf("}", slotStart);
    expect(css.slice(slotStart, slotEnd)).not.toContain("position: relative");
    const innerStart = css.indexOf('[data-annot-block="step"] .annot-doc-image-svg-slot > svg {');
    const innerEnd = css.indexOf("}", innerStart);
    const innerSection = css.slice(innerStart, innerEnd);
    expect(innerSection).not.toContain("position: absolute");
    expect(innerSection).not.toContain("inset: 0");
  });

  it("card image inner SVG carries margin: 0 to neutralise editor-shell #svg-root style leakage", () => {
    // Root cause: the editor's live canvas uses `<svg id="svg-root">`,
    // which the editor stylesheet styles with `margin: 20px auto`.
    // Pre-fix annotated bytes saved to `block.svg` carried that id;
    // when embedded in the doc shell the margin pushed the SVG 20px
    // down inside the slot — visible as a grey strip above the card
    // image. The editor's export path now strips the id, but legacy
    // saved docs already on disk still carry it. `margin: 0` on the
    // inner SVG rule neutralises the leakage for both forward and
    // backward compat.
    const css = buildStyleBlock(createEmptyDocument({ title: "Margin reset" }));
    const innerStart = css.indexOf('[data-annot-block="step"] .annot-doc-image-svg-slot > svg {');
    const innerEnd = css.indexOf("}", innerStart);
    expect(css.slice(innerStart, innerEnd)).toContain("margin: 0");
  });

  it("step blocks join the print break-inside avoid rule", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Print" }));
    const printStart = css.indexOf("@media print {");
    expect(printStart).toBeGreaterThan(-1);
    const printSection = css.slice(printStart);
    expect(printSection).toContain('[data-annot-block="step"] {');
    expect(printSection).toContain("break-inside: avoid");
  });
});

describe("injectDocumentStyles: cardLayout meta", () => {
  it("--annot-card-columns defaults to 1 when cardLayout is absent", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "Default columns" }));
    expect(css).toContain("--annot-card-columns: 1");
  });

  it("--annot-card-columns reflects cardLayout.columns when set numerically", () => {
    for (const n of [1, 2, 3] as const) {
      const css = buildStyleBlock(
        createEmptyDocument({ title: `Cols ${n}`, meta: { cardLayout: { columns: n } } }),
      );
      expect(css).toContain(`--annot-card-columns: ${n}`);
    }
  });

  it('--annot-card-columns is 1 when cardLayout.columns is "auto"', () => {
    // "auto" can't be a numeric CSS custom property used in repeat(),
    // so the variable falls back to 1; the actual grid-template-columns
    // value is generated inline in cardLayoutRules instead.
    const css = buildStyleBlock(
      createEmptyDocument({
        title: "Auto columns",
        meta: { cardLayout: { columns: "auto" } },
      }),
    );
    expect(css).toContain("--annot-card-columns: 1");
  });

  it("emits no article-level grid when cardLayout is absent", () => {
    const css = buildStyleBlock(createEmptyDocument({ title: "No cardLayout" }));
    // Negative: the typography block sets `max-width` but no
    // grid template on the article.
    expect(css).not.toContain("article[data-annot-doc] {\n  display: grid");
    expect(css).not.toContain(':has(> [data-annot-block="step"])');
  });

  it("emits no article-level grid when cardLayout.columns === 1", () => {
    // columns=1 is the same visual layout as block-flow; we leave
    // the existing article rule alone to keep byte-equivalent
    // output for single-column docs.
    const css = buildStyleBlock(
      createEmptyDocument({
        title: "One-column",
        meta: { cardLayout: { columns: 1 } },
      }),
    );
    expect(css).not.toContain("article[data-annot-doc] {\n  display: grid");
  });

  it("emits a numeric repeat() grid when cardLayout.columns >= 2", () => {
    const css = buildStyleBlock(
      createEmptyDocument({
        title: "Two columns",
        meta: { cardLayout: { columns: 2 } },
      }),
    );
    expect(css).toContain("article[data-annot-doc] {");
    expect(css).toContain("display: grid");
    expect(css).toContain(
      "grid-template-columns: repeat(var(--annot-card-columns), minmax(0, 1fr))",
    );
    // Default: every direct article child spans all columns;
    // step blocks (or `.annot-doc-block-host` wrappers containing
    // one in editor mode) opt back into auto placement so they
    // pack into the grid.
    expect(css).toContain("article[data-annot-doc] > * {");
    expect(css).toContain("grid-column: 1 / -1");
    expect(css).toContain('article[data-annot-doc] > [data-annot-block="step"] {');
    expect(css).toContain('article[data-annot-doc] > :has(> [data-annot-block="step"]) {');
    expect(css).toContain("grid-column: auto");
  });

  it('emits an auto-fill grid when cardLayout.columns === "auto"', () => {
    const css = buildStyleBlock(
      createEmptyDocument({
        title: "Auto columns",
        meta: { cardLayout: { columns: "auto" } },
      }),
    );
    expect(css).toContain("grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))");
  });

  it("hides insert-bars between two cards in multi-column mode so the grid packs horizontally", () => {
    // Editor render interleaves `<annot-doc-insert-bar>` between
    // every pair of blocks. In single-column mode they sit
    // between cards harmlessly. In multi-column mode their
    // default `grid-column: 1 / -1` would force a row break
    // between every pair of cards, leaving the second column
    // empty and packing cards into one column visually. Hide
    // just the bars sandwiched between two cards (or wrapped
    // cards) — bars at the article boundary or adjacent to a
    // non-card stay visible so non-card-insert UX still works.
    const css = buildStyleBlock(
      createEmptyDocument({
        title: "Two columns hide bars",
        meta: { cardLayout: { columns: 2 } },
      }),
    );
    // The hiding rule references both the read-only and editor
    // card selectors through `:is()` so it covers both render
    // paths. Probe a stable substring of the rule.
    expect(css).toContain("annot-doc-insert-bar:has(+ :is");
    expect(css).toContain("display: none");
  });

  it("survives a parse → serialize round-trip with cardLayout set", () => {
    const original = injectDocumentStyles(
      createEmptyDocument({
        title: "Card round-trip",
        meta: { cardLayout: { columns: 2, defaultStepLayout: "image-left" } },
      }),
    );
    const onceBytes = serializeDocument(original);
    const reparsed = parseDocument(onceBytes);
    expect(serializeDocument(reparsed)).toBe(onceBytes);
    expect(reparsed.meta.cardLayout).toEqual({ columns: 2, defaultStepLayout: "image-left" });
  });
});
