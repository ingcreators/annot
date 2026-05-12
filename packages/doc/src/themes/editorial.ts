/**
 * `editorial` theme — serif headings, generous line-height,
 * magazine-style block treatment, pull-quote styling.
 *
 * Phase 2 of `docs/plans/card-document-themes.md`. Aimed at
 * long-form prose docs — runbooks, post-mortems, design
 * documents — where reading comfort matters more than tight
 * information density. The serif heading family pulls readers
 * down the page; the warm off-white background is easier on
 * eyes than pure white for long sessions.
 */

import { cssStackFor } from "@ingcreators/annot-core/headless";
import type { Theme } from "./types.js";

const serifStack = cssStackFor("Annot Serif");

export const editorial: Theme = {
  id: "editorial",
  name: "Editorial",
  description: "Serif headings, off-white background, magazine-style pull quotes.",
  vars: [
    ["--annot-doc-bg", "#faf7f2"],
    ["--annot-doc-fg", "#1f1b16"],
    ["--annot-doc-muted", "#75695a"],
    ["--annot-doc-accent", "#8b2a2a"],
    ["--annot-doc-code-bg", "#f2ece2"],
    ["--annot-doc-callout-info-bg", "#f4ece0"],
    ["--annot-doc-callout-info-border", "#8b2a2a"],
    ["--annot-doc-callout-warn-bg", "#f9efd0"],
    ["--annot-doc-callout-warn-border", "#a06a1f"],
    ["--annot-doc-callout-note-bg", "#f2ece2"],
    ["--annot-doc-callout-note-border", "#75695a"],
    // Cards on the editorial theme read as "page extracts" —
    // warm cream fill, subtle border, soft shadow.
    ["--annot-card-bg", "#fffdf9"],
    ["--annot-card-border", "1px solid #e8ddc9"],
    ["--annot-card-shadow", "0 2px 8px rgba(80, 50, 20, 0.06)"],
    // Badge: classic burgundy accent, restrained shadow.
    ["--annot-step-badge-bg", "var(--annot-doc-accent)"],
    ["--annot-step-badge-fg", "#fffdf9"],
    ["--annot-step-badge-shadow", "0 2px 8px rgba(139, 42, 42, 0.20)"],
  ],
  darkVars: [
    ["--annot-doc-bg", "#1c1814"],
    ["--annot-doc-fg", "#f0e8db"],
    ["--annot-doc-muted", "#a89a85"],
    ["--annot-doc-accent", "#d97474"],
    ["--annot-doc-code-bg", "#2a241d"],
    ["--annot-doc-callout-info-bg", "#2a241d"],
    ["--annot-doc-callout-info-border", "#d97474"],
    ["--annot-doc-callout-warn-bg", "#3a2a1a"],
    ["--annot-doc-callout-warn-border", "#d4a374"],
    ["--annot-doc-callout-note-bg", "#2a241d"],
    ["--annot-doc-callout-note-border", "#a89a85"],
    ["--annot-card-bg", "#2a241d"],
    ["--annot-card-border", "1px solid #3a3025"],
    ["--annot-card-shadow", "0 2px 8px rgba(0, 0, 0, 0.30)"],
    ["--annot-step-badge-bg", "var(--annot-doc-accent)"],
    ["--annot-step-badge-fg", "#1c1814"],
    ["--annot-step-badge-shadow", "0 2px 8px rgba(217, 116, 116, 0.30)"],
  ],
  // Editorial-style badge — "N." (dot suffix) reads as a numbered
  // list marker rather than a chip, fitting the prose aesthetic.
  badgeLabelTemplate: "%n.",
  // Serif headings + pull-quote treatment + generous body
  // line-height. `extraCss` lands at the end of the style block,
  // so its selectors win against the structural defaults.
  extraCss: [
    // Serif h1 / h2 / h3 — body / lists stay sans for readability.
    `[data-annot-block="heading"] { font-family: ${serifStack}; }`,
    // Generous body line-height, slightly enlarged text size.
    "html, body { font-size: 17px; line-height: 1.75; }",
    // Pull-quote treatment: oversized opening glyph, italic body,
    // accent-coloured left border.
    '[data-annot-block="quote"] {',
    "  border-left: 4px solid var(--annot-doc-accent);",
    "  padding: 0.5rem 1.5rem 0.5rem 2rem;",
    "  font-style: italic;",
    "  font-size: 1.1em;",
    "  position: relative;",
    "}",
    // Badge tweaks — slightly larger numeral, no pill (the dot-
    // suffix template fills a wider box; the radius mimics a
    // numbered-list bullet).
    ":root {",
    "  --annot-step-badge-radius: 6px;",
    "  --annot-step-badge-font-size: 1.05rem;",
    "}",
  ].join("\n"),
};
