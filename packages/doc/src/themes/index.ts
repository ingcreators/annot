/**
 * Theme registry — public Tier A entry point for built-in
 * (and, eventually, plugin-supplied) `.annot.html` document
 * themes.
 *
 * Phase 1 of `docs/plans/card-document-themes.md`. Phase 1
 * ships the two legacy themes (`modern-light` + `modern-dark`)
 * matching the pre-refactor `meta.theme === "light" | "dark"`
 * output byte-for-byte. Phase 2 adds the three new themes
 * (`minimal` / `editorial` / `playful`) by extending this
 * registry; consumers go through `getTheme(id)` and the API
 * doesn't change.
 */

import { editorial } from "./editorial.js";
import { modernDark, modernLight } from "./legacy.js";
import { minimal } from "./minimal.js";
import { playful } from "./playful.js";
import type { Theme } from "./types.js";

export type { Theme, VarTuples } from "./types.js";

/** Stable identifiers for the built-in themes. The on-disk
 *  `meta.appearance.template` value MUST be one of these (or
 *  absent, falling back to the legacy `meta.theme` mapping). */
export type BuiltinThemeId = "modern-light" | "modern-dark" | "minimal" | "editorial" | "playful";

/** Built-in theme registry keyed by `meta.appearance.template`
 *  value. Phase 1 shipped the two legacy themes; Phase 2 adds
 *  the three new themes. */
export const THEMES: Readonly<Record<BuiltinThemeId, Theme>> = {
  "modern-light": modernLight,
  "modern-dark": modernDark,
  minimal,
  editorial,
  playful,
};

/** Convenience iterable for UI surfaces (the Appearance picker
 *  in Phase 3 enumerates this list to render its radio cards). */
export const BUILTIN_THEME_IDS: readonly BuiltinThemeId[] = [
  "modern-light",
  "modern-dark",
  "minimal",
  "editorial",
  "playful",
];

/** Look up a built-in theme by id. Falls back to `modern-light`
 *  (the format's default) when the id isn't in the registry —
 *  this keeps documents readable even when they reference a
 *  theme the host doesn't ship (e.g. a plugin theme on a host
 *  that hasn't loaded the plugin). */
export function getTheme(id: string | undefined): Theme {
  if (id !== undefined && Object.hasOwn(THEMES, id)) {
    const theme = THEMES[id as BuiltinThemeId];
    if (theme) return theme;
  }
  return modernLight;
}

/** Map the legacy `meta.theme` keyword to a theme + emission
 *  strategy. Phase 1's structural / theme split preserves the
 *  exact pre-refactor behaviour:
 *
 *   - `"light"` → `modern-light` theme, vars only (no dark
 *     media query).
 *   - `"dark"`  → `modern-dark` theme, vars only (the theme
 *     has no `darkVars` so nothing to emit).
 *   - `"auto"` (default) → `modern-light` theme + emit
 *     `darkVars` behind `@media (prefers-color-scheme: dark)`.
 */
export function pickLegacyTheme(theme: "auto" | "light" | "dark"): {
  theme: Theme;
  emitDarkMediaQuery: boolean;
} {
  if (theme === "dark") return { theme: modernDark, emitDarkMediaQuery: false };
  if (theme === "light") return { theme: modernLight, emitDarkMediaQuery: false };
  return { theme: modernLight, emitDarkMediaQuery: true };
}
