/**
 * `injectDocumentStyles(doc)` — Phase 2 of
 * `docs/plans/annot-html-document.md`.
 *
 * Returns a new `AnnotDocument` whose `styleBlock` carries a
 * canonical CSS payload covering: logical font-family stacks
 * (delegated to `@ingcreators/annot-core`'s
 * [multilingual-fonts-os-stack plan](../../../docs/plans/_done/multilingual-fonts-os-stack.md)),
 * base typography, per-block rules, callout tones, print rules,
 * and (for `theme === "auto"`) a `prefers-color-scheme: dark`
 * branch.
 *
 * Pure: no DOM dependency, no I/O. The output is the inner content
 * of the `<style>` element the serializer writes — see
 * `serialize.ts` for the wrapping (the `<style>` opaque-content
 * rule keeps round-trip byte-equivalence).
 *
 * Doc-property → CSS variable mapping:
 *
 * - `meta.maxWidth` (`narrow` / `medium` / `wide` / `full`)
 *   → `--annot-doc-max-width`.
 * - `meta.theme` (`auto` / `light` / `dark`):
 *   - `auto` (default): light vars at top + `@media
 *     (prefers-color-scheme: dark)` overrides.
 *   - `light`: light vars only; no dark branch.
 *   - `dark`: dark vars at top; no `prefers-color-scheme`
 *     branch.
 */

import { cssStackFor } from "@ingcreators/annot-core/headless";
import type { AnnotDocument, CardLayoutMeta, DocMeta, NumberingMeta } from "./types.js";

/** CSS values for each `meta.maxWidth` keyword. */
const MAX_WIDTH_VALUES: Readonly<Record<NonNullable<DocMeta["maxWidth"]>, string>> = {
  narrow: "600px",
  medium: "720px",
  wide: "960px",
  full: "100%",
};

/** Light-mode CSS custom property values. */
const LIGHT_VARS: ReadonlyArray<readonly [string, string]> = [
  ["--annot-doc-bg", "#ffffff"],
  ["--annot-doc-fg", "#1f2937"],
  ["--annot-doc-muted", "#6b7280"],
  ["--annot-doc-accent", "#2563eb"],
  ["--annot-doc-code-bg", "#f3f4f6"],
  ["--annot-doc-callout-info-bg", "#eff6ff"],
  ["--annot-doc-callout-info-border", "#2563eb"],
  ["--annot-doc-callout-warn-bg", "#fef3c7"],
  ["--annot-doc-callout-warn-border", "#d97706"],
  ["--annot-doc-callout-note-bg", "#f3f4f6"],
  ["--annot-doc-callout-note-border", "#6b7280"],
  // Card chrome — see `step` block kind in docs/annot-html-format.md.
  // Phase 2 of docs/plans/card-procedure-template.md.
  ["--annot-card-bg", "#ffffff"],
  ["--annot-card-border", "1px solid #e5e7eb"],
  ["--annot-card-shadow", "0 1px 2px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.08)"],
];

/** Dark-mode CSS custom property values (same key set as `LIGHT_VARS`). */
const DARK_VARS: ReadonlyArray<readonly [string, string]> = [
  ["--annot-doc-bg", "#111827"],
  ["--annot-doc-fg", "#f9fafb"],
  ["--annot-doc-muted", "#9ca3af"],
  ["--annot-doc-accent", "#60a5fa"],
  ["--annot-doc-code-bg", "#1f2937"],
  ["--annot-doc-callout-info-bg", "#1e3a8a"],
  ["--annot-doc-callout-info-border", "#60a5fa"],
  ["--annot-doc-callout-warn-bg", "#78350f"],
  ["--annot-doc-callout-warn-border", "#fbbf24"],
  ["--annot-doc-callout-note-bg", "#1f2937"],
  ["--annot-doc-callout-note-border", "#9ca3af"],
  // Card chrome dark-mode equivalents.
  ["--annot-card-bg", "#1f2937"],
  ["--annot-card-border", "1px solid #374151"],
  ["--annot-card-shadow", "0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.4)"],
];

/** Non-themed card sizing variables, emitted alongside
 *  `--annot-doc-max-width` in `:root`. Authored as constants here
 *  (rather than threaded through doc properties) because the
 *  per-doc settings live in `meta.cardLayout` — these are the
 *  unrelated geometry knobs. User-themes can override at the
 *  `:root` level. */
const CARD_SIZING_VARS: ReadonlyArray<readonly [string, string]> = [
  ["--annot-card-radius", "8px"],
  ["--annot-card-padding", "1rem"],
  ["--annot-card-gap", "1.5rem"],
];

/** Returns a new document with `styleBlock` set to canonical CSS.
 *  Idempotent: re-running replaces the previous styleBlock. */
export function injectDocumentStyles(doc: AnnotDocument): AnnotDocument {
  return { ...doc, styleBlock: buildStyleBlock(doc) };
}

/** Build the canonical inner CSS for the doc-style block. Pure. */
export function buildStyleBlock(doc: AnnotDocument): string {
  const maxWidthKey = doc.meta.maxWidth ?? "medium";
  const maxWidth = MAX_WIDTH_VALUES[maxWidthKey];
  const theme = doc.meta.theme ?? "auto";

  const sections: string[] = [];
  sections.push(rootSection(maxWidth, theme, doc.meta.cardLayout));
  sections.push(fontFamilyRules());
  sections.push(typographyRules());
  sections.push(blockRules());
  sections.push(stepBlockRules());
  sections.push(inlineRules());
  sections.push(tocRules());
  // Phase 13 — auto-numbering opt-in (`meta.numbering`).
  // Emits CSS counters that reset on the article element and
  // increment on each matching block. Skipped entirely when
  // the numbering meta is absent / both toggles false, so
  // existing docs serialise byte-equivalent.
  const numberingCss = numberingRules(doc.meta.numbering);
  if (numberingCss) sections.push(numberingCss);
  // Phase 2 of docs/plans/card-procedure-template.md —
  // article-level grid only when `meta.cardLayout` is set with
  // columns >= 2 (or "auto"). Otherwise the doc keeps its
  // existing block-flow layout byte-identical to pre-card docs.
  const cardLayoutCss = cardLayoutRules(doc.meta.cardLayout);
  if (cardLayoutCss) sections.push(cardLayoutCss);
  sections.push(printRules());
  if (theme === "auto") {
    sections.push(darkModeRules());
  }
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function rootSection(
  maxWidth: string,
  theme: "auto" | "light" | "dark",
  cardLayout: CardLayoutMeta | undefined,
): string {
  const vars = theme === "dark" ? DARK_VARS : LIGHT_VARS;
  const lines = vars.map(([name, value]) => `  ${name}: ${value};`);
  // `--annot-doc-max-width` is independent of theme; emit alongside.
  lines.unshift(`  --annot-doc-max-width: ${maxWidth};`);
  // Card sizing knobs sit alongside the doc-width var — useful
  // even for documents that don't currently use step blocks
  // (consumers may override at theme-level).
  for (const [name, value] of CARD_SIZING_VARS) {
    lines.push(`  ${name}: ${value};`);
  }
  // `--annot-card-columns` is driven by `meta.cardLayout.columns`
  // when set; defaults to 1 (single-column / stack). Emitted
  // even when cardLayout is absent so card-level overrides land
  // on a known default. "auto" is special-cased in
  // `cardLayoutRules` because `repeat(auto-fill, …)` doesn't
  // accept a custom-property keyword.
  const columns = cardLayout?.columns;
  const columnsValue = typeof columns === "number" ? `${columns}` : "1";
  lines.push(`  --annot-card-columns: ${columnsValue};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

function fontFamilyRules(): string {
  // Logical font-family resolution. The selectors mirror the SVG
  // export path's `injectLogicalFontStyles` so the same documents
  // render with the same OS font-stack regardless of which side
  // (HTML doc vs. embedded SVG) is doing the resolution.
  const stacks = [
    `[data-font-family="Annot Sans"] { font-family: ${cssStackFor("Annot Sans")}; }`,
    `[data-font-family="Annot Serif"] { font-family: ${cssStackFor("Annot Serif")}; }`,
    `[data-font-family="Annot Mono"] { font-family: ${cssStackFor("Annot Mono")}; }`,
  ];
  return stacks.join("\n");
}

function typographyRules(): string {
  const sansStack = cssStackFor("Annot Sans");
  return [
    "html, body {",
    "  margin: 0;",
    "  padding: 0;",
    "  background: var(--annot-doc-bg);",
    "  color: var(--annot-doc-fg);",
    `  font-family: ${sansStack};`,
    "  line-height: 1.6;",
    "  font-size: 16px;",
    "}",
    "article[data-annot-doc] {",
    "  max-width: var(--annot-doc-max-width);",
    "  margin: 0 auto;",
    "  padding: 2rem 1rem;",
    "}",
  ].join("\n");
}

function blockRules(): string {
  const monoStack = cssStackFor("Annot Mono");
  return [
    // Headings
    '[data-annot-block="heading"][data-level="1"] {',
    "  font-size: 2rem;",
    "  font-weight: 700;",
    "  line-height: 1.2;",
    "  margin: 2rem 0 1rem;",
    "}",
    '[data-annot-block="heading"][data-level="2"] {',
    "  font-size: 1.5rem;",
    "  font-weight: 700;",
    "  line-height: 1.3;",
    "  margin: 1.5rem 0 0.75rem;",
    "}",
    '[data-annot-block="heading"][data-level="3"] {',
    "  font-size: 1.25rem;",
    "  font-weight: 600;",
    "  line-height: 1.4;",
    "  margin: 1.25rem 0 0.5rem;",
    "}",
    // Paragraph
    '[data-annot-block="paragraph"] {',
    "  margin: 0.75rem 0;",
    "}",
    // List
    '[data-annot-block="list"] {',
    "  margin: 0.75rem 0;",
    "  padding-left: 1.5rem;",
    "}",
    '[data-annot-block="list"] > li {',
    "  margin: 0.25rem 0;",
    "}",
    // Code
    '[data-annot-block="code"] {',
    "  background: var(--annot-doc-code-bg);",
    "  border-radius: 4px;",
    "  padding: 0.75rem 1rem;",
    "  margin: 1rem 0;",
    "  overflow-x: auto;",
    `  font-family: ${monoStack};`,
    "  font-size: 0.9rem;",
    "  line-height: 1.5;",
    "}",
    // Quote
    '[data-annot-block="quote"] {',
    "  margin: 1rem 0;",
    "  padding: 0.5rem 1rem;",
    "  border-left: 4px solid var(--annot-doc-muted);",
    "  color: var(--annot-doc-muted);",
    "}",
    '[data-annot-block="quote"] p {',
    "  margin: 0.5rem 0;",
    "}",
    // Callout
    '[data-annot-block="callout"] {',
    "  margin: 1rem 0;",
    "  padding: 0.75rem 1rem;",
    "  border-radius: 4px;",
    "  border-left: 4px solid;",
    "}",
    '[data-annot-block="callout"][data-tone="info"] {',
    "  background: var(--annot-doc-callout-info-bg);",
    "  border-left-color: var(--annot-doc-callout-info-border);",
    "}",
    '[data-annot-block="callout"][data-tone="warn"] {',
    "  background: var(--annot-doc-callout-warn-bg);",
    "  border-left-color: var(--annot-doc-callout-warn-border);",
    "}",
    '[data-annot-block="callout"][data-tone="note"] {',
    "  background: var(--annot-doc-callout-note-bg);",
    "  border-left-color: var(--annot-doc-callout-note-border);",
    "}",
    '[data-annot-block="callout"] p {',
    "  margin: 0.25rem 0;",
    "}",
    // Divider
    '[data-annot-block="divider"] {',
    "  border: none;",
    "  border-top: 1px solid var(--annot-doc-muted);",
    "  margin: 2rem 0;",
    "}",
    // Image (figure with embedded SVG)
    '[data-annot-block="image"] {',
    "  margin: 1.5rem 0;",
    "}",
    // Inline SVG: scale down to fit the column but never up.
    // The captured bitmap is embedded at its natural pixel size
    // (the `<svg>` carries `width="…px" height="…px"`); without
    // a `max-width` clamp the document column gets pushed past
    // its declared `--annot-doc-max-width` for any image wider
    // than the container. `width: 100%` pre-Phase had the
    // opposite problem: every image stretched edge-to-edge,
    // which the in-app view doesn't do.
    '[data-annot-block="image"] svg {',
    "  max-width: 100%;",
    "  height: auto;",
    "  display: block;",
    "  margin: 0 auto;",
    "}",
    '[data-annot-block="image"] figcaption {',
    "  font-size: 0.9rem;",
    "  color: var(--annot-doc-muted);",
    "  margin-top: 0.5rem;",
    "  text-align: center;",
    "}",
  ].join("\n");
}

/**
 * Phase 2 of `docs/plans/card-procedure-template.md` — `step`
 * block card chrome plus the five per-layout grid templates.
 *
 * Always emitted: even documents without `meta.cardLayout`
 * (i.e. single-column step stacks) need the card chrome and
 * per-layout grid to render their step blocks correctly.
 * The article-level multi-column grid is opt-in via
 * `cardLayoutRules`.
 *
 * Layout strategy:
 *
 * - `image-top` (default) / `image-bottom` / `image-left` /
 *   `image-right` use named-area CSS Grid. The three child
 *   slots (`<svg>`, `<h3 data-step-title>`, `<p data-step-body>`)
 *   are assigned fixed grid-area names (`image` / `title` /
 *   `body`) so only `grid-template-areas` + `grid-template-*`
 *   vary per layout.
 * - `image-fill` uses absolute positioning instead — the title
 *   and body overlay the bottom of the image with a translucent
 *   backdrop. Different model from the four area-based layouts,
 *   so a separate selector block.
 */
function stepBlockRules(): string {
  const sansStack = cssStackFor("Annot Sans");
  return [
    // Card chrome shared by every layout.
    '[data-annot-block="step"] {',
    "  background: var(--annot-card-bg);",
    "  border: var(--annot-card-border);",
    "  border-radius: var(--annot-card-radius);",
    "  box-shadow: var(--annot-card-shadow);",
    "  padding: var(--annot-card-padding);",
    "  margin: 1rem 0;",
    "  /* Anchor for absolute-positioned children — the in-block",
    "     layout switcher (Phase 3b of card-procedure-template) and",
    "     the image-fill title/body overlay both rely on this. */",
    "  position: relative;",
    "  /* Clip the image-fill overlay's backdrop and any rounded-corner",
    "     image edges within the card boundary. */",
    "  overflow: hidden;",
    "}",
    // Default child styling — applies to image-top / -bottom /
    // -left / -right (image-fill overrides these below).
    //
    // Standalone view (saved bytes): the SVG is a DIRECT child
    // of the section. The selector `> svg` lands the SVG in
    // the `image` grid area and clamps it to the card width.
    //
    // Editor view (`<annot-doc-shell>` editing mode): the
    // shell wraps the SVG in a `.annot-doc-image-svg-slot` div
    // for the IntersectionObserver-driven lazy materialisation
    // (see `materialiseImageSlot` in `annot-doc-shell.ts`).
    // The wrapper has an inline `aspect-ratio` style derived
    // from the SVG's viewBox so layout settles before bytes
    // mount; we mirror the same grid-area + max-width clamp on
    // the wrapper, then let the descendant SVG fill it.
    // Without this rule large screenshots (the common case —
    // capture is typically 1500–2000 px wide) overflow the
    // card horizontally and dominate it vertically.
    '[data-annot-block="step"] > svg,',
    '[data-annot-block="step"] > .annot-doc-image-svg-slot {',
    "  grid-area: image;",
    "  width: 100%;",
    "  max-width: 100%;",
    "  height: auto;",
    "  display: block;",
    "  margin: 0;",
    "}",
    '[data-annot-block="step"] .annot-doc-image-svg-slot > svg {',
    "  width: 100%;",
    "  height: auto;",
    "  display: block;",
    "  /* Cap the visual height so a tall-aspect screenshot",
    "     doesn't dominate the card; the inline aspect-ratio on",
    "     the wrapper still drives the slot's pre-mount layout. */",
    "  max-height: 70vh;",
    "  object-fit: contain;",
    "}",
    '[data-annot-block="step"] > [data-step-title] {',
    "  grid-area: title;",
    "  margin: 0;",
    "  font-size: 1.15rem;",
    "  font-weight: 600;",
    "  line-height: 1.3;",
    `  font-family: ${sansStack};`,
    "}",
    '[data-annot-block="step"] > [data-step-body] {',
    "  grid-area: body;",
    "  margin: 0;",
    "  color: var(--annot-doc-fg);",
    "  line-height: 1.5;",
    "}",
    // image-top — default. Image on top, title + body stacked
    // below.
    '[data-annot-block="step"]:not([data-step-layout]),',
    '[data-annot-block="step"][data-step-layout="image-top"] {',
    "  display: grid;",
    '  grid-template-areas:\n    "image"\n    "title"\n    "body";',
    "  grid-template-columns: 1fr;",
    "  grid-template-rows: auto auto auto;",
    "  gap: 0.5rem;",
    "}",
    // image-bottom — title + body stacked above the image.
    '[data-annot-block="step"][data-step-layout="image-bottom"] {',
    "  display: grid;",
    '  grid-template-areas:\n    "title"\n    "body"\n    "image";',
    "  grid-template-columns: 1fr;",
    "  grid-template-rows: auto auto auto;",
    "  gap: 0.5rem;",
    "}",
    // image-left — two columns: image on the left, title + body
    // stacked on the right.
    '[data-annot-block="step"][data-step-layout="image-left"] {',
    "  display: grid;",
    '  grid-template-areas:\n    "image title"\n    "image body";',
    "  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);",
    "  grid-template-rows: auto 1fr;",
    "  gap: 0.5rem 1rem;",
    "}",
    // image-right — mirror of image-left.
    '[data-annot-block="step"][data-step-layout="image-right"] {',
    "  display: grid;",
    '  grid-template-areas:\n    "title image"\n    "body image";',
    "  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);",
    "  grid-template-rows: auto 1fr;",
    "  gap: 0.5rem 1rem;",
    "}",
    // image-fill — image covers the card; title + body overlay
    // the bottom edge with a translucent backdrop. Different
    // positioning model from the four area-based layouts.
    // `position: relative` is inherited from the shared step rule.
    '[data-annot-block="step"][data-step-layout="image-fill"] {',
    "  display: block;",
    "  padding: 0;",
    "}",
    // image-fill image sizing — applies to direct SVG
    // (standalone view) AND to the editor's slot wrapper +
    // inner SVG. Same dual-selector pattern as the
    // area-based layouts above.
    '[data-annot-block="step"][data-step-layout="image-fill"] > svg,',
    '[data-annot-block="step"][data-step-layout="image-fill"] > .annot-doc-image-svg-slot {',
    "  width: 100%;",
    "  height: auto;",
    "  display: block;",
    "  margin: 0;",
    "}",
    '[data-annot-block="step"][data-step-layout="image-fill"] > [data-step-title],',
    '[data-annot-block="step"][data-step-layout="image-fill"] > [data-step-body] {',
    "  position: absolute;",
    "  left: 0;",
    "  right: 0;",
    "  margin: 0;",
    "  padding: 0.4rem 1rem;",
    "  background: rgba(0, 0, 0, 0.65);",
    "  color: #ffffff;",
    "}",
    '[data-annot-block="step"][data-step-layout="image-fill"] > [data-step-title] {',
    "  bottom: 2rem;",
    "  font-size: 1.05rem;",
    "  font-weight: 600;",
    "  line-height: 1.3;",
    "}",
    '[data-annot-block="step"][data-step-layout="image-fill"] > [data-step-body] {',
    "  bottom: 0;",
    "  font-size: 0.9rem;",
    "  line-height: 1.4;",
    "}",
    // Phase 7a — image-less step blocks. The empty `svg` field
    // becomes `data-step-image-less="1"` on the section (emitted
    // by both the serializer for standalone view and the editor's
    // renderStep). We collapse the grid to a single text column
    // regardless of `data-step-layout` so a missing image doesn't
    // leave a tall empty row / column. The image-fill overlay
    // positioning is also undone — there's no underlying image to
    // overlay onto, so the title / body return to the normal flow.
    '[data-annot-block="step"][data-step-image-less] {',
    "  display: grid;",
    '  grid-template-areas:\n    "title"\n    "body";',
    "  grid-template-columns: 1fr;",
    "  grid-template-rows: auto auto;",
    "  gap: 0.5rem;",
    "  padding: var(--annot-card-padding);",
    "}",
    '[data-annot-block="step"][data-step-image-less] > [data-step-title],',
    '[data-annot-block="step"][data-step-image-less] > [data-step-body] {',
    "  position: static;",
    "  background: transparent;",
    "  color: var(--annot-doc-fg);",
    "  padding: 0;",
    "  bottom: auto;",
    "  font-size: 1.15rem;",
    "  line-height: 1.3;",
    "}",
    '[data-annot-block="step"][data-step-image-less] > [data-step-body] {',
    "  font-size: 1rem;",
    "  font-weight: 400;",
    "  line-height: 1.5;",
    "}",
    '[data-annot-block="step"][data-step-image-less] > [data-step-title] {',
    "  font-weight: 600;",
    `  font-family: ${sansStack};`,
    "}",
    // Phase 7b — URL chip. Rendered as a `<a data-step-link>`
    // anchor below the title. The chip uses the document accent
    // colour, a small external-link glyph (via ::after), and a
    // monospace URL or label run. It sits in the grid's `link`
    // area when present; the per-layout grid templates above
    // don't name a `link` area, so we declare it on the chip
    // itself with `grid-row: auto` and let it flow under the
    // title (or alongside it in left/right layouts).
    '[data-annot-block="step"] > [data-step-link] {',
    "  display: inline-flex;",
    "  align-items: center;",
    "  gap: 0.35em;",
    "  margin: 0.25rem 0 0;",
    "  padding: 0.2em 0.55em;",
    "  border: 1px solid var(--annot-doc-accent);",
    "  border-radius: 999px;",
    "  background: transparent;",
    "  color: var(--annot-doc-accent);",
    "  font-size: 0.85rem;",
    `  font-family: ${sansStack};`,
    "  text-decoration: none;",
    "  width: fit-content;",
    "  max-width: 100%;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "  white-space: nowrap;",
    "  /* Place under the title in the default vertical stack;",
    "     the four area-based layouts don't reserve a link area",
    "     so the chip flows after the body. The `image-top` and",
    "     `image-bottom` two-column-less layouts both stack",
    "     vertically — the chip lands after body in normal flow.",
    "     For the side-by-side layouts (image-left / -right) we",
    "     keep the chip in the text column under the body. */",
    "  grid-column: 1 / -1;",
    "}",
    '[data-annot-block="step"] > [data-step-link]:hover,',
    '[data-annot-block="step"] > [data-step-link]:focus-visible {',
    "  background: var(--annot-doc-accent);",
    "  color: var(--annot-doc-bg);",
    "  text-decoration: none;",
    "  outline: none;",
    "}",
    // Decorative external-link glyph. SVG via CSS background so",
    // the anchor stays a single DOM node. Inherits `currentColor`
    // through `mask-image` for theme correctness.
    '[data-annot-block="step"] > [data-step-link]::before {',
    '  content: "";',
    "  width: 0.8em;",
    "  height: 0.8em;",
    "  flex-shrink: 0;",
    "  background-color: currentColor;",
    `  mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='currentColor' d='M10 2h4v4h-1V3.71l-5.65 5.64-.7-.7L12.29 3H10V2zm-7 1h5v1H4v8h8V8h1v5H3V3z'/></svg>");`,
    `  -webkit-mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='currentColor' d='M10 2h4v4h-1V3.71l-5.65 5.64-.7-.7L12.29 3H10V2zm-7 1h5v1H4v8h8V8h1v5H3V3z'/></svg>");`,
    "  mask-size: contain;",
    "  -webkit-mask-size: contain;",
    "  mask-repeat: no-repeat;",
    "  -webkit-mask-repeat: no-repeat;",
    "}",
    // Image-fill layout: chip overlays the bottom of the image
    // alongside the title / body backdrop. Stays inside the
    // overlay zone with the same translucent-on-dark treatment.
    '[data-annot-block="step"][data-step-layout="image-fill"] > [data-step-link] {',
    "  position: absolute;",
    "  bottom: 0.4rem;",
    "  right: 1rem;",
    "  background: rgba(0, 0, 0, 0.65);",
    "  color: #ffffff;",
    "  border-color: rgba(255, 255, 255, 0.6);",
    "}",
    '[data-annot-block="step"][data-step-layout="image-fill"] > [data-step-link]:hover,',
    '[data-annot-block="step"][data-step-layout="image-fill"] > [data-step-link]:focus-visible {',
    "  background: rgba(255, 255, 255, 0.95);",
    "  color: #000000;",
    "  border-color: #ffffff;",
    "}",
    // Phase 7b edit UX — the inline URL edit row appears below
    // the title in editing mode (annot-doc-shell renderStep
    // emits it inside the `<section>` next to the chip when
    // editable). Kept visually subtle so it doesn't compete
    // with the body content.
    '[data-annot-block="step"] > .annot-doc-step-link-editor {',
    "  display: flex;",
    "  align-items: center;",
    "  gap: 0.4rem;",
    "  margin: 0.4rem 0 0;",
    "  grid-column: 1 / -1;",
    "  font-size: 0.85rem;",
    `  font-family: ${sansStack};`,
    "  color: var(--annot-doc-muted);",
    "}",
    "[data-annot-block=\"step\"] > .annot-doc-step-link-editor input[type='url'] {",
    "  flex: 1 1 auto;",
    "  min-width: 0;",
    "  padding: 0.25rem 0.5rem;",
    "  font: inherit;",
    "  color: var(--annot-doc-fg);",
    "  background: var(--annot-doc-bg);",
    "  border: 1px solid var(--annot-doc-muted, #d1d5db);",
    "  border-radius: 4px;",
    "}",
    "[data-annot-block=\"step\"] > .annot-doc-step-link-editor input[type='url']:focus {",
    "  outline: 2px solid var(--annot-doc-accent);",
    "  outline-offset: 1px;",
    "  border-color: var(--annot-doc-accent);",
    "}",
    '[data-annot-block="step"] > .annot-doc-step-link-editor button {',
    "  padding: 0.25rem 0.6rem;",
    "  font: inherit;",
    "  font-size: 0.8rem;",
    "  color: var(--annot-doc-fg);",
    "  background: var(--annot-doc-bg);",
    "  border: 1px solid var(--annot-doc-muted, #d1d5db);",
    "  border-radius: 4px;",
    "  cursor: pointer;",
    "}",
    '[data-annot-block="step"] > .annot-doc-step-link-editor button:hover {',
    "  border-color: var(--annot-doc-accent);",
    "  color: var(--annot-doc-accent);",
    "}",
  ].join("\n");
}

/**
 * Article-level multi-column grid for documents that opt into
 * `meta.cardLayout`. Skipped entirely when:
 *
 * - `meta.cardLayout` is absent (existing docs untouched);
 * - `columns === 1` (single-column block-flow is byte-identical
 *   to the pre-card behavior, no point swapping to grid).
 *
 * Non-step children get `grid-column: 1 / -1` so headings,
 * paragraphs, callouts etc. continue to span the full content
 * width — only the step blocks pack into the grid columns.
 *
 * Two structural shapes have to be handled:
 *
 *   - Read-only render: blocks are direct children of `<article>`,
 *     so `article > [data-annot-block="step"]` packs into the
 *     grid, everything else gets `grid-column: 1 / -1`.
 *   - Editor render: the shell wraps each block in a
 *     `.annot-doc-block-host` div (with `<annot-doc-insert-bar>`s
 *     interleaved). The step block is then a grandchild. We use
 *     `:has(> [data-annot-block="step"])` to find the wrapper
 *     that holds a step block so it packs into the grid; every
 *     other direct article child spans the full row.
 */
function cardLayoutRules(cardLayout: CardLayoutMeta | undefined): string {
  if (!cardLayout) return "";
  const columns = cardLayout.columns ?? 1;
  if (columns === 1) return "";
  const gridTemplate =
    columns === "auto"
      ? "repeat(auto-fill, minmax(320px, 1fr))"
      : "repeat(var(--annot-card-columns), minmax(0, 1fr))";
  return [
    "article[data-annot-doc] {",
    "  display: grid;",
    `  grid-template-columns: ${gridTemplate};`,
    "  gap: var(--annot-card-gap);",
    "  align-items: start;",
    "}",
    // Default: every direct child spans the full row. This covers
    // headings / paragraphs / callouts / insert-bars / wrappers
    // around non-step blocks. The next two rules carve out the
    // step exceptions.
    "article[data-annot-doc] > * {",
    "  grid-column: 1 / -1;",
    "}",
    // Read-only render path — step blocks are direct children.
    'article[data-annot-doc] > [data-annot-block="step"] {',
    "  grid-column: auto;",
    "}",
    // Editor render path — step blocks are grandchildren wrapped
    // by `.annot-doc-block-host`. The `:has()` selector reaches
    // through one level to identify the right wrapper.
    'article[data-annot-doc] > :has(> [data-annot-block="step"]) {',
    "  grid-column: auto;",
    "}",
  ].join("\n");
}

function inlineRules(): string {
  const monoStack = cssStackFor("Annot Mono");
  return [
    "a {",
    "  color: var(--annot-doc-accent);",
    "  text-decoration: underline;",
    "}",
    // Inline code (NOT the `code` block kind — that's `<pre><code>`)
    "p code, li code, blockquote code, aside code, h1 code, h2 code, h3 code, figcaption code {",
    `  font-family: ${monoStack};`,
    "  font-size: 0.9em;",
    "  background: var(--annot-doc-code-bg);",
    "  padding: 0.1em 0.3em;",
    "  border-radius: 3px;",
    "}",
    "strong { font-weight: 700; }",
    "em { font-style: italic; }",
    "u { text-decoration: underline; }",
  ].join("\n");
}

/**
 * Standalone-view TOC. The `<nav data-annot-toc>` chrome only
 * appears in serializer output (the parser drops it on read), so
 * these rules style the standalone HTML view exclusively. Hidden
 * on print to keep paginated output focused on body content.
 */
function tocRules(): string {
  return [
    "nav[data-annot-toc] {",
    "  margin: 1.5rem 0 2rem;",
    "  padding: 1rem 1.25rem;",
    "  background: var(--annot-doc-code-bg);",
    "  border-radius: 6px;",
    "  font-size: 0.95rem;",
    "}",
    "nav[data-annot-toc] [data-annot-toc-title] {",
    "  margin: 0 0 0.5rem;",
    "  font-size: 1rem;",
    "  font-weight: 600;",
    "  color: var(--annot-doc-muted);",
    "  text-transform: uppercase;",
    "  letter-spacing: 0.05em;",
    "}",
    "nav[data-annot-toc] ul {",
    "  list-style: none;",
    "  margin: 0;",
    "  padding: 0;",
    "}",
    "nav[data-annot-toc] li {",
    "  margin: 0.25rem 0;",
    "}",
    'nav[data-annot-toc] li[data-annot-toc-level="2"] {',
    "  padding-left: 1rem;",
    "}",
    'nav[data-annot-toc] li[data-annot-toc-level="3"] {',
    "  padding-left: 2rem;",
    "}",
    "nav[data-annot-toc] a {",
    "  color: var(--annot-doc-fg);",
    "  text-decoration: none;",
    "}",
    "nav[data-annot-toc] a:hover,",
    "nav[data-annot-toc] a:focus {",
    "  color: var(--annot-doc-accent);",
    "  text-decoration: underline;",
    "}",
  ].join("\n");
}

function printRules(): string {
  return [
    "@media print {",
    "  html, body {",
    "    background: white;",
    "    color: black;",
    "  }",
    "  article[data-annot-doc] {",
    "    max-width: none;",
    "    padding: 0;",
    "  }",
    "  nav[data-annot-toc] {",
    "    display: none;",
    "  }",
    '  [data-annot-block="image"] {',
    "    break-inside: avoid;",
    "  }",
    // Step cards stay intact across page breaks — title + body +
    // image visually belong together. Same rule as image blocks.
    '  [data-annot-block="step"] {',
    "    break-inside: avoid;",
    // Lift the drop-shadow + tinted background that look right
    // on screen but waste toner in print.
    "    box-shadow: none;",
    "    background: white;",
    "    color: black;",
    "  }",
    // Image-fill overlay's translucent dark backdrop becomes
    // pure black on screen → unreadable in print. Switch the
    // overlay to a light backdrop with dark text for print.
    '  [data-annot-block="step"][data-step-layout="image-fill"] > [data-step-title],',
    '  [data-annot-block="step"][data-step-layout="image-fill"] > [data-step-body] {',
    "    background: rgba(255, 255, 255, 0.85);",
    "    color: black;",
    "  }",
    '  [data-annot-block="heading"] {',
    "    break-after: avoid-page;",
    "  }",
    "}",
  ].join("\n");
}

function darkModeRules(): string {
  const lines = DARK_VARS.map(([name, value]) => `    ${name}: ${value};`);
  return ["@media (prefers-color-scheme: dark) {", "  :root {", ...lines, "  }", "}"].join("\n");
}

/**
 * Phase 13 — auto-numbering rules. Returns the empty string
 * when neither `headings` nor `figures` is enabled (so the
 * style block doesn't grow when numbering is opt-out).
 *
 * Heading numbering uses three nested CSS counters (`annot-h1
 * / annot-h2 / annot-h3`) reset on the article element. Each
 * level increments its own counter and resets the deeper
 * levels — standard hierarchical-numbering pattern (1., 1.1,
 * 1.1.1).
 *
 * Figure numbering uses a single counter (`annot-figure`)
 * incremented on every image-block figure in document order.
 * The label sits on `figcaption::before`, which means image
 * blocks WITHOUT a figcaption don't get a visible number —
 * acceptable trade-off (the count still increments globally,
 * so the next figure's number stays right). The label
 * defaults to `"Figure "` and falls back to the user-supplied
 * `figureLabel` when set.
 */
function numberingRules(numbering: NumberingMeta | undefined): string {
  if (!numbering) return "";
  const headings = numbering.headings === true;
  const figures = numbering.figures === true;
  if (!headings && !figures) return "";

  const lines: string[] = [];

  // Combined `counter-reset` on the article so a single
  // declaration covers whichever counters are active. Browsers
  // ignore unknown counter names in `counter()` lookups, so
  // emitting both "annot-h1 annot-h2 annot-h3" and "annot-figure"
  // when only one feature is on is harmless — but we trim it
  // for readability.
  const resetCounters: string[] = [];
  if (headings) resetCounters.push("annot-h1", "annot-h2", "annot-h3");
  if (figures) resetCounters.push("annot-figure");
  lines.push("article[data-annot-doc] {");
  lines.push(`  counter-reset: ${resetCounters.join(" ")};`);
  lines.push("}");

  if (headings) {
    lines.push(
      // h1: increment self, reset deeper levels.
      'article[data-annot-doc] [data-annot-block="heading"][data-level="1"]::before {',
      "  counter-increment: annot-h1;",
      "  counter-reset: annot-h2 annot-h3;",
      '  content: counter(annot-h1) ". ";',
      "}",
      // h2: increment self, reset h3.
      'article[data-annot-doc] [data-annot-block="heading"][data-level="2"]::before {',
      "  counter-increment: annot-h2;",
      "  counter-reset: annot-h3;",
      '  content: counter(annot-h1) "." counter(annot-h2) " ";',
      "}",
      // h3: increment self.
      'article[data-annot-doc] [data-annot-block="heading"][data-level="3"]::before {',
      "  counter-increment: annot-h3;",
      '  content: counter(annot-h1) "." counter(annot-h2) "." counter(annot-h3) " ";',
      "}",
    );
  }

  if (figures) {
    const label = numbering.figureLabel ?? "Figure ";
    // Image-block figures: increment the figure counter on
    // the figure element itself (so blocks without a
    // figcaption still tick the count), and prepend the
    // visible label to the figcaption.
    lines.push(
      'article[data-annot-doc] [data-annot-block="image"] {',
      "  counter-increment: annot-figure;",
      "}",
      'article[data-annot-doc] [data-annot-block="image"] figcaption::before {',
      `  content: ${JSON.stringify(label)} counter(annot-figure) ": ";`,
      "}",
    );
  }

  return lines.join("\n");
}
