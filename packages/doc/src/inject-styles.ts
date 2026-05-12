/**
 * `injectDocumentStyles(doc)` — Phase 2 of
 * `docs/plans/_done/annot-html-document.md`, refactored by
 * Phase 1 of `docs/plans/card-document-themes.md` into a
 * structural / theme CSS split.
 *
 * Returns a new `AnnotDocument` whose `styleBlock` carries a
 * canonical CSS payload covering: logical font-family stacks
 * (delegated to `@ingcreators/annot-core`'s
 * [multilingual-fonts-os-stack plan](../../../docs/plans/_done/multilingual-fonts-os-stack.md)),
 * base typography, per-block rules, callout tones, print rules,
 * and (for the `auto` mode) a `prefers-color-scheme: dark`
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
 * - `meta.theme` (`auto` / `light` / `dark`) — legacy field:
 *   - `auto` (default): pick `modern-light`, emit `vars` at top
 *     + `@media (prefers-color-scheme: dark)` block with
 *     `darkVars`.
 *   - `light`: pick `modern-light`, emit `vars` only.
 *   - `dark`: pick `modern-dark` (which already carries DARK_VARS
 *     as its `vars`); no `prefers-color-scheme` branch.
 *
 * Phase 2 of `card-document-themes.md` adds
 * `meta.appearance.template`, which takes precedence over
 * `meta.theme` when set. Phase 1 only refactors the existing
 * legacy-theme codepath into the new pipeline so the output
 * stays byte-identical for documents that haven't opted in.
 */

import { cssStackFor } from "@ingcreators/annot-core/headless";
import type { Theme, VarTuples } from "./themes/index.js";
import { getTheme, pickLegacyTheme } from "./themes/index.js";
import { sanitiseCustomCss } from "./themes/sanitise-custom-css.js";
import type {
  AnnotDocument,
  AppearanceFontFamily,
  CardLayoutMeta,
  DocMeta,
  NumberingMeta,
} from "./types.js";

/** CSS values for each `meta.maxWidth` keyword. */
const MAX_WIDTH_VALUES: Readonly<Record<NonNullable<DocMeta["maxWidth"]>, string>> = {
  narrow: "600px",
  medium: "720px",
  wide: "960px",
  full: "100%",
};

/** Non-themed card sizing variables, emitted alongside
 *  `--annot-doc-max-width` in `:root`. Authored as constants here
 *  (rather than threaded through doc properties) because the
 *  per-doc settings live in `meta.cardLayout` — these are the
 *  unrelated geometry knobs. User-themes can override at the
 *  `:root` level.
 *
 *  Phase 1 of `card-document-themes.md` keeps these structural
 *  (always emitted, regardless of theme). The plan classifies
 *  card-radius / -padding / -gap as themable — those moves wait
 *  until the new themes in Phase 2 actually need to override
 *  them; until then they sit here so the byte output stays
 *  identical to pre-Phase-1. */
const CARD_SIZING_VARS: VarTuples = [
  ["--annot-card-radius", "8px"],
  ["--annot-card-padding", "1rem"],
  ["--annot-card-gap", "1.5rem"],
  // Step badge geometry — Phase 2 of
  // docs/plans/_done/card-step-auto-numbering.md. Always emitted so
  // user-CSS overrides have a stable name to target even before
  // step numbering is opted in. `9999px` is the "always pill"
  // value — single-digit content renders as a circle (square
  // box rounded fully), longer content stretches to a pill.
  ["--annot-step-badge-min-size", "2rem"],
  ["--annot-step-badge-padding", "0 0.5rem"],
  ["--annot-step-badge-radius", "9999px"],
  ["--annot-step-badge-font-size", "0.95rem"],
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
  const themeMode = doc.meta.theme ?? "auto";
  // Phase 2 of `card-document-themes.md` — `meta.appearance.template`
  // takes precedence over the legacy `meta.theme` keyword when set.
  // Picked theme always emits its `darkVars` behind a `prefers-
  // color-scheme: dark` block (theme authors opt in by declaring
  // `darkVars`; absence = "this theme is light-only or
  // dark-only"). The legacy fallback below preserves the
  // pre-Phase-2 byte output for documents that haven't opted in.
  const appearanceTemplate = doc.meta.appearance?.template;
  let theme: Theme;
  let emitDarkMediaQuery: boolean;
  if (appearanceTemplate !== undefined) {
    theme = getTheme(appearanceTemplate);
    emitDarkMediaQuery = theme.darkVars !== undefined;
  } else {
    ({ theme, emitDarkMediaQuery } = pickLegacyTheme(themeMode));
  }

  const sections: string[] = [];
  sections.push(rootSection(maxWidth, theme, doc.meta.cardLayout));
  sections.push(fontFamilyRules());
  sections.push(typographyRules());
  sections.push(blockRules());
  sections.push(stepBlockRules());
  sections.push(inlineRules());
  sections.push(tocRules());
  sections.push(docHeaderRules());
  // Phase 13 — auto-numbering opt-in (`meta.numbering`).
  // Emits CSS counters that reset on the article element and
  // increment on each matching block. Skipped entirely when
  // the numbering meta is absent / both toggles false, so
  // existing docs serialise byte-equivalent.
  const numberingCss = numberingRules(doc.meta.numbering);
  if (numberingCss) sections.push(numberingCss);
  // Phase 2 of docs/plans/_done/card-procedure-template.md —
  // article-level grid only when `meta.cardLayout` is set with
  // columns >= 2 (or "auto"). Otherwise the doc keeps its
  // existing block-flow layout byte-identical to pre-card docs.
  const cardLayoutCss = cardLayoutRules(doc.meta.cardLayout);
  if (cardLayoutCss) sections.push(cardLayoutCss);
  sections.push(printRules());
  if (emitDarkMediaQuery && theme.darkVars) {
    sections.push(darkModeRules(theme.darkVars));
  }
  // Phase 1 of `card-document-themes.md` — theme `extraCss`
  // landing slot. Sits at the end of the style block so theme-
  // specific selectors win over the structural defaults that
  // share their specificity. Legacy themes don't set this; the
  // branch stays inert until Phase 2's themes need it.
  if (theme.extraCss) sections.push(theme.extraCss);
  // Phase 4 of `card-document-themes.md` — font family overrides.
  // Postlude sits AFTER `extraCss` so a user-supplied font
  // family wins even against editorial's serif headings rule
  // (the editorial theme picked `Annot Serif` for `<h1>` etc.;
  // when the user changes the `serif` token's resolved family,
  // we want the new family to flow through to editorial's
  // headings too).
  const fontFamilyCss = fontFamilyOverrideRules(doc.meta.appearance?.fontFamily);
  if (fontFamilyCss) sections.push(fontFamilyCss);
  // Phase 5 of `card-document-themes.md` — custom CSS escape
  // hatch. Sanitised at render time AND on parse so a stored
  // pre-sanitised value gets a second pass even if the parser's
  // pre-sanitiser missed something. Sits at the very end so
  // user CSS wins against every other layer.
  const customCss = doc.meta.appearance?.customCss;
  if (customCss !== undefined && customCss.length > 0) {
    const sanitised = sanitiseCustomCss(customCss).css;
    if (sanitised.length > 0) sections.push(sanitised);
  }
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function rootSection(
  maxWidth: string,
  theme: Theme,
  cardLayout: CardLayoutMeta | undefined,
): string {
  const lines = theme.vars.map(([name, value]) => `  ${name}: ${value};`);
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

/**
 * Phase 4 of `docs/plans/card-document-themes.md` — emit
 * postlude CSS that overrides the structural font-family
 * declarations when `meta.appearance.fontFamily` is set. Each
 * field is independent — overriding `sans` doesn't touch
 * `serif` / `mono` resolution.
 *
 * Values that match a logical font token (`Annot Sans` /
 * `Annot Serif` / `Annot Mono`) get resolved via `cssStackFor`
 * so a user picking "Annot Serif" for `sans` substitutes the
 * canonical serif stack. Any other input is passed verbatim —
 * power users can paste `"Helvetica Neue, sans-serif"` and the
 * raw value lands in the CSS.
 *
 * Returns `""` when no fontFamily field is set (existing
 * documents stay byte-identical).
 *
 * Coverage:
 *
 *   - `sans` → `html, body` (default body inheritance) +
 *     `[data-font-family="Annot Sans"]` (explicit opt-ins).
 *   - `serif` → `[data-font-family="Annot Serif"]` (explicit
 *     opt-ins). The editorial theme's `extraCss` already
 *     picked Annot Serif for headings, so a user changing the
 *     `serif` field overrides that pick too (the postlude
 *     emits AFTER `extraCss`, so its rule lands later in the
 *     cascade).
 *   - `mono` → `[data-annot-block="code"]`,
 *     `[data-font-family="Annot Mono"]`, and the inline-code
 *     selectors mirroring the typography rule.
 *
 * Surfaces NOT covered (acceptable v1 trade-off): the per-block
 * step / TOC / dochead rules that inline `cssStackFor("Annot
 * Sans")` literally won't pick up the override. Phase 5's
 * `customCss` is the escape hatch for users who need
 * comprehensive control.
 */
function fontFamilyOverrideRules(fontFamily: AppearanceFontFamily | undefined): string {
  if (!fontFamily) return "";
  const sans = resolveFontFamilyValue(fontFamily.sans);
  const serif = resolveFontFamilyValue(fontFamily.serif);
  const mono = resolveFontFamilyValue(fontFamily.mono);
  if (sans === undefined && serif === undefined && mono === undefined) return "";

  const lines: string[] = [];
  if (sans !== undefined) {
    lines.push('html, body, [data-font-family="Annot Sans"] {', `  font-family: ${sans};`, "}");
  }
  if (serif !== undefined) {
    lines.push('[data-font-family="Annot Serif"] {', `  font-family: ${serif};`, "}");
  }
  if (mono !== undefined) {
    // Mirror the typography rule's inline-code selectors plus
    // the explicit-token + code-block selectors. Keep this
    // selector list in sync with `inlineRules()` + `blockRules()`
    // when adding new mono surfaces.
    lines.push(
      '[data-annot-block="code"], [data-font-family="Annot Mono"], p code, li code, blockquote code, aside code, h1 code, h2 code, h3 code, figcaption code {',
      `  font-family: ${mono};`,
      "}",
    );
  }
  return lines.join("\n");
}

/** Resolve a user-supplied family value. Logical tokens
 *  (`Annot Sans` / `Annot Serif` / `Annot Mono`) resolve to
 *  the canonical OS-aware stack via `cssStackFor`; everything
 *  else passes through unchanged. */
function resolveFontFamilyValue(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === "Annot Sans" || trimmed === "Annot Serif" || trimmed === "Annot Mono") {
    return cssStackFor(trimmed);
  }
  return trimmed;
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
 * Phase 2 of `docs/plans/_done/card-procedure-template.md` — `step`
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
    // Phase 7d-polish: the card image area is locked to 16:9
    // regardless of the source bitmap's aspect ratio. This
    // mirrors the PPTX export's slide canvas (also 16:9) and
    // gives every card in a multi-column grid the same height.
    // Non-16:9 sources letterbox inside the frame via SVG's
    // default `preserveAspectRatio="xMidYMid meet"`.
    //
    // The slot div is the 16:9 frame; `overflow: hidden` clips
    // any pan/zoom state that wanders outside (the controller
    // already clamps pan, but the clip is belt-and-braces).
    //
    // Phase 7d-polish follow-up: the slot background is the
    // CARD background, not the code-block grey. Otherwise a
    // tall screenshot in a 16:9 frame shows a visible grey
    // strip above / below the letterboxed image (user-reported
    // regression). With `transparent` the section's card
    // background fills the letterbox area, which blends into
    // the card chrome. A subtle pre-mount placeholder appears
    // ONLY while the SVG hasn't materialised yet, keyed off
    // the `data-annot-image-svg` attribute that
    // `materialiseImageSlot` removes after inlining.
    '[data-annot-block="step"] > svg,',
    '[data-annot-block="step"] > .annot-doc-image-svg-slot {',
    "  grid-area: image;",
    "  width: 100%;",
    "  max-width: 100%;",
    "  aspect-ratio: 16 / 9;",
    "  display: block;",
    "  margin: 0;",
    "  overflow: hidden;",
    "  background: transparent;",
    "}",
    '[data-annot-block="step"] > .annot-doc-image-svg-slot[data-annot-image-svg] {',
    "  /* Pre-mount placeholder background — visible only while",
    "     the slot is reserving layout space; cleared by",
    "     `materialiseImageSlot` once the SVG inlines. */",
    "  background: var(--annot-doc-code-bg, #f3f4f6);",
    "}",
    '[data-annot-block="step"] .annot-doc-image-svg-slot > svg {',
    "  width: 100%;",
    "  height: 100%;",
    "  display: block;",
    // Host-guard: pre-#618 editor-saved SVG bytes may still
    // carry `id="svg-root"` (the editor's live canvas id). That
    // id is styled with `margin: 20px auto` in `editor.css` —
    // when embedded into the doc shell, that margin would push
    // the SVG ~20px down inside the slot (visible as a grey
    // strip above annotated cards). The export path now strips
    // the id on save, but legacy docs already on disk still
    // carry it. Forcing `margin: 0` here neutralises the
    // leakage for both forward and backward compat.
    "  margin: 0;",
    "}",
    '[data-annot-block="step"] > [data-step-title] {',
    "  grid-area: title;",
    "  margin: 0;",
    "  font-size: 1.15rem;",
    "  font-weight: 600;",
    "  line-height: 1.3;",
    `  font-family: ${sansStack};`,
    // Wrap long unbreakable strings (URLs, no-space code-style
    // identifiers, the user reproducer's 'aaaa...' input). Pair
    // with `min-width: 0` so CSS Grid's `min-content` track
    // sizing doesn't blow the column out to fit a long word.
    // Without `min-width: 0`, image-left / -right cards bleed
    // out horizontally and drag the screenshot column with them.
    "  min-width: 0;",
    "  overflow-wrap: anywhere;",
    "  word-break: break-word;",
    "}",
    '[data-annot-block="step"] > [data-step-body] {',
    "  grid-area: body;",
    "  margin: 0;",
    "  color: var(--annot-doc-fg);",
    "  line-height: 1.5;",
    "  min-width: 0;",
    "  overflow-wrap: anywhere;",
    "  word-break: break-word;",
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
    // area-based layouts above. Phase 7d-polish: also locked to
    // 16:9 (matches the area-based layouts + PPTX slide).
    '[data-annot-block="step"][data-step-layout="image-fill"] > svg,',
    '[data-annot-block="step"][data-step-layout="image-fill"] > .annot-doc-image-svg-slot {',
    "  width: 100%;",
    "  aspect-ratio: 16 / 9;",
    "  display: block;",
    "  margin: 0;",
    "  overflow: hidden;",
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
  // Reusable selector fragment that matches both render paths
  // for a step card:
  //   - Read-only: a direct `[data-annot-block="step"]` child.
  //   - Editor:    a `.annot-doc-block-host` wrapper whose child
  //                IS a step card (detected via `:has(>)`).
  const cardOrWrapper = '[data-annot-block="step"], :has(> [data-annot-block="step"])';
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
    // Editor render — `#renderEditingBody` interleaves an
    // `<annot-doc-insert-bar>` between every pair of blocks.
    // Those bars are full-row siblings, so in multi-column mode
    // they break CSS grid auto-flow: with `grid-column: 1 / -1`
    // each between-card bar forces the next card onto a new row
    // and the second column stays empty. Hide just the bars that
    // sit BETWEEN two cards (the bar precedes a card AND follows
    // a card). Bars at the article boundary, or between a card
    // and a non-card, stay visible so users can still insert
    // blocks. Users who want to insert another card BETWEEN two
    // cards can still use the block toolbar's Insert above /
    // Insert below buttons.
    `article[data-annot-doc] > :is(${cardOrWrapper}) + annot-doc-insert-bar:has(+ :is(${cardOrWrapper})) {`,
    "  display: none;",
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

/**
 * Phase 7c — Scribe-style document header. The
 * `<section data-annot-doc-header>` chrome only appears in
 * serializer output (the parser drops it on read), so these
 * rules style the standalone HTML view + editor preview
 * exclusively.
 *
 * Layout: 2-column grid (icon | content) when an icon is set;
 * single-column (content only) when not. Title (h1) suppresses
 * the body's first heading rendering only when the title text
 * matches — we don't try to do that here; the user can choose
 * to omit the first H1 from the doc body if they don't want
 * duplication.
 */
function docHeaderRules(): string {
  const sansStack = cssStackFor("Annot Sans");
  return [
    "section[data-annot-doc-header] {",
    "  display: grid;",
    "  grid-template-columns: auto 1fr;",
    "  align-items: center;",
    "  gap: 1.25rem;",
    "  margin: 0 0 2rem;",
    "  padding: 1.5rem 0;",
    "  border-bottom: 1px solid var(--annot-doc-muted);",
    "}",
    // Single-column when no icon — the title / description /
    // meta column spans the full row.
    "section[data-annot-doc-header]:not(:has([data-annot-doc-header-icon])) {",
    "  grid-template-columns: 1fr;",
    "}",
    "section[data-annot-doc-header] [data-annot-doc-header-icon] {",
    "  width: 64px;",
    "  height: 64px;",
    "  border-radius: 12px;",
    "  object-fit: contain;",
    "  background: var(--annot-doc-code-bg);",
    "  display: block;",
    "}",
    "section[data-annot-doc-header] [data-annot-doc-header-title] {",
    "  margin: 0;",
    `  font-family: ${sansStack};`,
    "  font-size: 1.85rem;",
    "  font-weight: 700;",
    "  line-height: 1.2;",
    "  color: var(--annot-doc-fg);",
    "}",
    "section[data-annot-doc-header] [data-annot-doc-header-description] {",
    "  margin: 0.4rem 0 0;",
    "  font-size: 1rem;",
    "  line-height: 1.5;",
    "  color: var(--annot-doc-muted);",
    "}",
    "section[data-annot-doc-header] [data-annot-doc-header-meta] {",
    "  display: flex;",
    "  flex-wrap: wrap;",
    "  gap: 0.5rem 1rem;",
    "  margin: 0.6rem 0 0;",
    "  font-size: 0.85rem;",
    "  color: var(--annot-doc-muted);",
    `  font-family: ${sansStack};`,
    "}",
    "section[data-annot-doc-header] [data-annot-doc-header-author]::before {",
    '  content: "By ";',
    "  color: var(--annot-doc-muted);",
    "}",
    // Multi-column card grid: the header should span the entire
    // grid row (above every step card column).
    "article[data-annot-doc] > section[data-annot-doc-header] {",
    "  grid-column: 1 / -1;",
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

function darkModeRules(darkVars: VarTuples): string {
  const lines = darkVars.map(([name, value]) => `    ${name}: ${value};`);
  return ["@media (prefers-color-scheme: dark) {", "  :root {", ...lines, "  }", "}"].join("\n");
}

/**
 * Phase 13 — auto-numbering rules. Returns the empty string
 * when no `numbering` field is enabled (so the style block
 * doesn't grow when numbering is opt-out).
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
 *
 * Step numbering (Phase 2 of
 * `docs/plans/card-step-auto-numbering.md`) uses a single
 * counter (`annot-step`) incremented on every step block. The
 * value renders on a `::before` pseudo-element styled as a
 * Scribe-style numbered badge anchored to the card's top-left
 * corner. The `stepLabel` field parameterises the rendered
 * content via a `%n` placeholder; absent → `"%n"` (numeral
 * only). The badge sits **inside** the card's `overflow:
 * hidden` clip — this avoids the DOM restructure the plan
 * originally floated. Visual contrast comes from the badge's
 * accent-colour fill + shadow, not from bleeding past the
 * card boundary.
 */
function numberingRules(numbering: NumberingMeta | undefined): string {
  if (!numbering) return "";
  const headings = numbering.headings === true;
  const figures = numbering.figures === true;
  const steps = numbering.steps === true;
  if (!headings && !figures && !steps) return "";

  const lines: string[] = [];

  // Combined `counter-reset` on the article so a single
  // declaration covers whichever counters are active. Browsers
  // ignore unknown counter names in `counter()` lookups, so
  // emitting all of "annot-h1 annot-h2 annot-h3", "annot-figure",
  // and "annot-step" when only one feature is on is harmless —
  // but we trim it for readability.
  const resetCounters: string[] = [];
  if (headings) resetCounters.push("annot-h1", "annot-h2", "annot-h3");
  if (figures) resetCounters.push("annot-figure");
  if (steps) resetCounters.push("annot-step");
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

  if (steps) {
    const sansStack = cssStackFor("Annot Sans");
    const labelCss = stepLabelToCssContent(numbering.stepLabel ?? "%n");
    lines.push(
      // Step block carries the increment (not the `::before`)
      // so the count ticks even on layouts where a future
      // override might hide the visual badge.
      'article[data-annot-doc] [data-annot-block="step"] {',
      "  counter-increment: annot-step;",
      "}",
      // Default badge — anchored to the card's top-left corner.
      // `position: absolute` works because the section already
      // carries `position: relative` for the existing in-block
      // controls. `z-index: 2` lifts the badge above the
      // image-fill overlay (z-index: 1 in the existing rules).
      'article[data-annot-doc] [data-annot-block="step"]::before {',
      `  content: ${labelCss};`,
      "  position: absolute;",
      "  top: 0.75rem;",
      "  left: 0.75rem;",
      "  min-width: var(--annot-step-badge-min-size);",
      "  height: var(--annot-step-badge-min-size);",
      "  padding: var(--annot-step-badge-padding);",
      "  box-sizing: border-box;",
      "  display: inline-flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  background: var(--annot-step-badge-bg);",
      "  color: var(--annot-step-badge-fg);",
      "  border-radius: var(--annot-step-badge-radius);",
      `  font-family: ${sansStack};`,
      "  font-weight: 700;",
      "  font-size: var(--annot-step-badge-font-size);",
      "  line-height: 1;",
      "  letter-spacing: 0.01em;",
      "  box-shadow: var(--annot-step-badge-shadow);",
      "  z-index: 2;",
      "  pointer-events: none;",
      "}",
      // image-fill — the badge sits on top of the screenshot.
      // Swap to a translucent-dark backdrop with blur so the
      // numeral stays legible regardless of underlying image
      // content. Override colour/shadow but keep geometry +
      // typography from the default rule above.
      'article[data-annot-doc] [data-annot-block="step"][data-step-layout="image-fill"]::before {',
      "  background: rgba(0, 0, 0, 0.55);",
      "  color: #ffffff;",
      "  backdrop-filter: blur(8px) saturate(150%);",
      "  -webkit-backdrop-filter: blur(8px) saturate(150%);",
      "  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);",
      "}",
      // Title clearance for layouts where the title lands in
      // the top-left of the card — without this rule the badge
      // (top: 0.75rem; left: 0.75rem) overlaps the title text.
      //
      // Layouts affected:
      //   - image-bottom: title is row 1 of the grid → top of card
      //   - image-right:  title is in the LEFT column → top-left
      //
      // Other layouts (image-top, image-left, image-fill) don't
      // need this because the title sits below / right of /
      // overlay'd on the image, not in the badge's footprint.
      //
      // The padding has to be wide enough to clear the WIDEST
      // badge the template can produce. For the default `%n`
      // template the badge is just `min-width` wide (~2rem +
      // padding). For `Step %n` / `#%n` / similar templates
      // with literal text, the badge expands to fit the
      // literal — so we add a per-character allowance derived
      // from the template's literal length. The estimate uses
      // 0.6em per character (a decent average for the bold
      // sans stack at 0.95rem font-size).
      'article[data-annot-doc] [data-annot-block="step"][data-step-layout="image-bottom"] > [data-step-title],',
      'article[data-annot-doc] [data-annot-block="step"][data-step-layout="image-right"] > [data-step-title],',
      // Image-less step blocks collapse to a text-only column
      // regardless of `data-step-layout`, so the title always
      // ends up at the top-left of the card. Apply the same
      // clearance — without this, picking "image-fill" (or any
      // other layout) on an image-less card leaves the badge
      // overlapping the title.
      'article[data-annot-doc] [data-annot-block="step"][data-step-image-less] > [data-step-title] {',
      `  padding-left: calc(var(--annot-step-badge-min-size) + ${stepBadgeLiteralAllowance(numbering.stepLabel ?? "%n")} + 1rem);`,
      "}",
    );
  }

  return lines.join("\n");
}

/**
 * Estimate the extra horizontal space the step badge needs
 * beyond `--annot-step-badge-min-size`, given the user's
 * `stepLabel` template. Returns a CSS length string ready to
 * drop into a `calc()` expression.
 *
 * The badge's actual width = `max(min-size, content-width +
 * 2 * 0.5rem padding)`. For the default `%n` template the
 * content is just a 1-2 digit number → content-width is
 * already inside `min-size`, so no extra allowance needed
 * (return `0px`).
 *
 * For templates with literal text (`Step %n` / `#%n` / `%n.`)
 * the badge expands. We estimate `0.6em` per literal
 * character at the badge's font size (`0.95rem`) and add a
 * fixed `1em` for the digit slot. The estimate is intentionally
 * generous to err on the side of more clearance.
 *
 * Phase 2 of `docs/plans/_done/card-step-auto-numbering.md`
 * shipped a fixed 1rem clearance that worked for `%n` but
 * broke for `Step %n` (user-reported overlap).
 */
function stepBadgeLiteralAllowance(template: string): string {
  // Literal = template minus the `%n` placeholder. Empty
  // string means no literal text → no allowance needed.
  const literal = template.replace(/%n/g, "");
  if (literal.length === 0) return "0px";
  // 0.6em per literal char (rough average for bold sans at
  // 0.95rem); convert to rem against the structural badge
  // font size (`0.95rem`). 0.6 × 0.95 ≈ 0.57rem per char.
  const literalRem = literal.length * 0.57;
  // Round to one decimal so the generated CSS stays readable.
  const rounded = Math.round(literalRem * 10) / 10;
  return `${rounded}rem`;
}

/**
 * Parse a `stepLabel` template into a CSS `content` value.
 * `%n` is the only special token; everything else is literal
 * text. Returns a space-separated list of `"literal"` strings
 * and `counter(annot-step)` calls.
 *
 * Examples:
 *   `"%n"`        → `counter(annot-step)`
 *   `"Step %n"`   → `"Step " counter(annot-step)`
 *   `"%n."`       → `counter(annot-step) "."`
 *   `"%n /"`      → `counter(annot-step) " /"`
 *
 * Empty literal segments are omitted so the output stays
 * compact. A template with no `%n` is treated as a pure
 * literal — the counter still increments on the step block,
 * but the badge displays the static text. (Hopeless authoring,
 * but spec'd for completeness.)
 */
function stepLabelToCssContent(template: string): string {
  const parts = template.split("%n");
  if (parts.length === 1) {
    // No `%n` — pure literal.
    return JSON.stringify(template);
  }
  const pieces: string[] = [];
  parts.forEach((segment, i) => {
    if (segment.length > 0) pieces.push(JSON.stringify(segment));
    if (i < parts.length - 1) pieces.push("counter(annot-step)");
  });
  return pieces.join(" ");
}
