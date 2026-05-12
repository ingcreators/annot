/**
 * `playful` theme — pastel palette, larger radii, badge as
 * chat-bubble shape, oversize typography.
 *
 * Phase 2 of `docs/plans/card-document-themes.md`. Aimed at
 * onboarding flows, marketing-facing how-to guides, and any
 * doc where approachability matters more than density. The
 * pastel palette + generous radii read as friendly without
 * crossing into "cute" — still professional enough for
 * customer-facing material.
 */

import type { Theme } from "./types.js";

export const playful: Theme = {
  id: "playful",
  name: "Playful",
  description: "Pastel palette, generous radii, chat-bubble badge.",
  vars: [
    ["--annot-doc-bg", "#fff8f5"],
    ["--annot-doc-fg", "#2c1e3a"],
    ["--annot-doc-muted", "#7b6a8c"],
    ["--annot-doc-accent", "#e96d8a"],
    ["--annot-doc-code-bg", "#fdf0e8"],
    ["--annot-doc-callout-info-bg", "#e8f4fd"],
    ["--annot-doc-callout-info-border", "#5fa8e0"],
    ["--annot-doc-callout-warn-bg", "#fff4d6"],
    ["--annot-doc-callout-warn-border", "#e8a93a"],
    ["--annot-doc-callout-note-bg", "#f4ecf8"],
    ["--annot-doc-callout-note-border", "#9b7cb6"],
    // Cards: rounded, generous fill, soft pink-tinted shadow.
    ["--annot-card-bg", "#ffffff"],
    ["--annot-card-border", "1px solid #fce0e5"],
    ["--annot-card-shadow", "0 6px 24px rgba(233, 109, 138, 0.12)"],
    // Badge: pink accent, larger shadow halo for a "popped"
    // effect. The chat-bubble shape comes from `extraCss`'s
    // border-radius override (asymmetric corners).
    ["--annot-step-badge-bg", "var(--annot-doc-accent)"],
    ["--annot-step-badge-fg", "#ffffff"],
    ["--annot-step-badge-shadow", "0 4px 16px rgba(233, 109, 138, 0.35)"],
  ],
  darkVars: [
    ["--annot-doc-bg", "#1a1424"],
    ["--annot-doc-fg", "#f8ecef"],
    ["--annot-doc-muted", "#a89cb8"],
    ["--annot-doc-accent", "#f48eaa"],
    ["--annot-doc-code-bg", "#2a1f36"],
    ["--annot-doc-callout-info-bg", "#1f2c3e"],
    ["--annot-doc-callout-info-border", "#5fa8e0"],
    ["--annot-doc-callout-warn-bg", "#3a2e1a"],
    ["--annot-doc-callout-warn-border", "#e8a93a"],
    ["--annot-doc-callout-note-bg", "#2a1f36"],
    ["--annot-doc-callout-note-border", "#9b7cb6"],
    ["--annot-card-bg", "#241a32"],
    ["--annot-card-border", "1px solid #3a2a48"],
    ["--annot-card-shadow", "0 6px 24px rgba(0, 0, 0, 0.40)"],
    ["--annot-step-badge-bg", "var(--annot-doc-accent)"],
    ["--annot-step-badge-fg", "#1a1424"],
    ["--annot-step-badge-shadow", "0 4px 16px rgba(244, 142, 170, 0.40)"],
  ],
  // Chat-bubble badge: asymmetric corner radii (rounded everywhere
  // EXCEPT the bottom-left, which gets a tail-like flat corner).
  // Larger card radius + bolder typography reinforce the friendly
  // aesthetic.
  extraCss: [
    ":root {",
    "  --annot-card-radius: 16px;",
    "  --annot-step-badge-radius: 18px 18px 18px 6px;",
    "  --annot-step-badge-font-size: 1.05rem;",
    "}",
    // Slightly oversize headings.
    'article[data-annot-doc] [data-annot-block="heading"][data-level="1"] {',
    "  font-size: 2.4rem;",
    "  letter-spacing: -0.02em;",
    "}",
    'article[data-annot-doc] [data-annot-block="heading"][data-level="2"] {',
    "  font-size: 1.75rem;",
    "}",
  ].join("\n"),
  pptxPalette: {
    // Soft cream slide bg matching the CSS theme's `#fff8f5`.
    slideBg: "FFF8F5",
    slideFg: "2C1E3A",
    // Pink pastel accent — the chat-bubble badge.
    accent: "E96D8A",
    accentFg: "FFFFFF",
    muted: "7B6A8C",
  },
};
