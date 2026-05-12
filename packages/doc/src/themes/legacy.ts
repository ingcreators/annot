/**
 * Legacy themes — the `modern-light` and `modern-dark` shipped
 * before `meta.appearance` landed. Held in their own module so
 * Phase 1's structural / theme split can drop into existing
 * documents byte-for-byte: the two themes carry the same CSS
 * custom-property values + dark-mode pair the inline
 * `LIGHT_VARS` / `DARK_VARS` constants used to.
 *
 * Phase 1 of `docs/plans/card-document-themes.md`. Subsequent
 * phases add `minimal` / `editorial` / `playful` themes
 * alongside; the legacy `meta.theme` keyword keeps mapping to
 * these two regardless of which new themes are registered.
 */

import type { Theme, VarTuples } from "./types.js";

/** Light-mode CSS custom property values (used by `modern-light`
 *  + as the dark-mode fallback for any theme without a
 *  `darkVars` override). Order matches the on-disk byte order
 *  pre-Phase-1. */
const MODERN_LIGHT_VARS: VarTuples = [
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
  // Phase 2 of docs/plans/_done/card-procedure-template.md.
  ["--annot-card-bg", "#ffffff"],
  ["--annot-card-border", "1px solid #e5e7eb"],
  ["--annot-card-shadow", "0 1px 2px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.08)"],
  // Step badge — Phase 2 of docs/plans/_done/card-step-auto-numbering.md.
  // Only consumed when `meta.numbering.steps === true` (the
  // `::before` rule is opt-in). Emitting the vars
  // unconditionally lets future themes / user CSS override them
  // even before they're active.
  ["--annot-step-badge-bg", "var(--annot-doc-accent)"],
  ["--annot-step-badge-fg", "#ffffff"],
  ["--annot-step-badge-shadow", "0 4px 12px rgba(37, 99, 235, 0.25)"],
];

/** Dark-mode overrides for the legacy themes. Same key set as
 *  `MODERN_LIGHT_VARS`. */
const MODERN_LIGHT_DARK_VARS: VarTuples = [
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
  // Step badge — dark-mode pair. Accent colour is brighter in
  // dark mode (`#60a5fa` per the existing `--annot-doc-accent`),
  // so the shadow tracks accordingly.
  ["--annot-step-badge-bg", "var(--annot-doc-accent)"],
  ["--annot-step-badge-fg", "#0b1220"],
  ["--annot-step-badge-shadow", "0 4px 12px rgba(96, 165, 250, 0.30)"],
];

/** `modern-light` — the default theme. Carries both `vars` and
 *  `darkVars` so it works in `auto` mode (light at root +
 *  `prefers-color-scheme: dark` overrides) and in light-only
 *  mode (`vars` flat, no media query). */
export const modernLight: Theme = {
  id: "modern-light",
  name: "Modern Light",
  description: "Soft shadows, blue accent, white background.",
  vars: MODERN_LIGHT_VARS,
  darkVars: MODERN_LIGHT_DARK_VARS,
};

/** `modern-dark` — the legacy `meta.theme === "dark"` pair.
 *  Renders dark unconditionally (no `prefers-color-scheme`
 *  branch). Authoring a doc with this theme means "always show
 *  dark to readers regardless of their OS preference". */
export const modernDark: Theme = {
  id: "modern-dark",
  name: "Modern Dark",
  description: "Always-dark variant of Modern Light.",
  vars: MODERN_LIGHT_DARK_VARS,
};
