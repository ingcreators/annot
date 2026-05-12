/**
 * `minimal` theme — no shadows, hairline borders only,
 * mono-toned palette. Tight typography.
 *
 * Phase 2 of `docs/plans/card-document-themes.md`. The
 * minimal theme strips visual chrome to make screenshot
 * content the primary focus — a documentation-first aesthetic
 * for procedural / reference docs where the visual treatment
 * should disappear.
 */

import type { Theme } from "./types.js";

export const minimal: Theme = {
  id: "minimal",
  name: "Minimal",
  description: "Hairline borders, no shadows, neutral mono-toned palette.",
  vars: [
    ["--annot-doc-bg", "#ffffff"],
    ["--annot-doc-fg", "#111111"],
    ["--annot-doc-muted", "#666666"],
    ["--annot-doc-accent", "#111111"],
    ["--annot-doc-code-bg", "#f5f5f5"],
    ["--annot-doc-callout-info-bg", "#f5f5f5"],
    ["--annot-doc-callout-info-border", "#111111"],
    ["--annot-doc-callout-warn-bg", "#f5f5f5"],
    ["--annot-doc-callout-warn-border", "#666666"],
    ["--annot-doc-callout-note-bg", "#f5f5f5"],
    ["--annot-doc-callout-note-border", "#cccccc"],
    // Hairline card chrome — 1px border, no shadow, no fill
    // tint. The bg matches the doc background so cards read as
    // "framed regions" rather than elevated surfaces.
    ["--annot-card-bg", "#ffffff"],
    ["--annot-card-border", "1px solid #e5e5e5"],
    ["--annot-card-shadow", "none"],
    // Step badge — black square with white numeral. Sharper
    // than the default pill, matches the minimal aesthetic.
    ["--annot-step-badge-bg", "#111111"],
    ["--annot-step-badge-fg", "#ffffff"],
    ["--annot-step-badge-shadow", "none"],
  ],
  darkVars: [
    ["--annot-doc-bg", "#0a0a0a"],
    ["--annot-doc-fg", "#eeeeee"],
    ["--annot-doc-muted", "#999999"],
    ["--annot-doc-accent", "#eeeeee"],
    ["--annot-doc-code-bg", "#1a1a1a"],
    ["--annot-doc-callout-info-bg", "#1a1a1a"],
    ["--annot-doc-callout-info-border", "#eeeeee"],
    ["--annot-doc-callout-warn-bg", "#1a1a1a"],
    ["--annot-doc-callout-warn-border", "#999999"],
    ["--annot-doc-callout-note-bg", "#1a1a1a"],
    ["--annot-doc-callout-note-border", "#333333"],
    ["--annot-card-bg", "#0a0a0a"],
    ["--annot-card-border", "1px solid #2a2a2a"],
    ["--annot-card-shadow", "none"],
    ["--annot-step-badge-bg", "#eeeeee"],
    ["--annot-step-badge-fg", "#0a0a0a"],
    ["--annot-step-badge-shadow", "none"],
  ],
  // Slightly less-rounded badge (square-ish corners), matches
  // the hairline-border aesthetic. `extraCss` overrides the
  // structural `--annot-step-badge-radius` after `:root`.
  extraCss: ":root { --annot-step-badge-radius: 4px; --annot-card-radius: 0; }",
  pptxPalette: {
    slideBg: "FFFFFF",
    slideFg: "111111",
    // Minimal's CSS accent is `#111111` (black) — same as fg.
    // Pair it with white badge text for a pure mono treatment.
    accent: "111111",
    accentFg: "FFFFFF",
    muted: "666666",
  },
};
