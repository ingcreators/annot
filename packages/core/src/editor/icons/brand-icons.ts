/**
 * Brand-glyph SVG strings used by the storage chip in the gallery
 * sidebar. Treated as Tier-B data and folded into the `BUILTIN_ICONS`
 * registry under dotted ids (`brand.github`, `brand.google_drive`)
 * so the call sites read identically to every other host icon
 * (`builtinIcon("brand.github")`).
 *
 * **Trademark notice.** "GitHub" and the GitHub Mark are trademarks
 * of GitHub, Inc. "Google Drive" and the Drive logo are trademarks
 * of Google LLC. The path data below is the official mark provided
 * by each vendor for indicating product integration; we render it
 * unmodified (geometry + Drive's brand colours preserved verbatim)
 * to comply with each company's brand guidelines:
 *
 *   - GitHub Logos & Usage: https://github.com/logos
 *   - Google Drive Branding Guidelines:
 *     https://developers.google.com/drive/api/guides/branding
 *
 * Specifically:
 *
 * 1. Geometry is verbatim from the published mark — no scaling
 *    distortion, no path mutation. The `viewBox` matches the
 *    upstream asset (16×16 for GitHub, 87.3×78 for Drive).
 * 2. The GitHub Mark uses `fill="currentColor"`, which is the
 *    monochrome usage GitHub explicitly permits in their guidelines
 *    ("you may render the mark in any colour that contrasts with
 *    its background"). This keeps the icon theme-aware in the
 *    sidebar without violating the "do not modify" rule — we are
 *    choosing a permitted fill colour, not editing the mark.
 * 3. The Drive logo uses the four official brand colours
 *    (#0066DA, #00AC47, #EA4335, #00832D, #2684FC, #FFBA00)
 *    hard-coded so the multi-colour mark renders correctly in
 *    both light and dark host themes — Google's guidelines require
 *    the multi-colour mark in product-integration UI, never a
 *    recolour. The trade-off is that this icon does NOT theme-
 *    adapt; that is the brand-required behaviour.
 *
 * If GitHub or Google update their published mark in a way that
 * supersedes the path data here, mirror the upstream change in this
 * file — never patch a stale mark in place.
 *
 * Reserved registry ids: hosts and plugin authors should NOT
 * override `brand.*` keys. The dotted prefix is documented as a
 * host-reserved namespace in `docs/plugin-api/icons.md`.
 */

/**
 * GitHub Mark (the simplified silhouette mark, sometimes called
 * "Invertocat"). Verbatim path data from `github.com/logos`.
 *
 * Why the simplified Mark, not the Octocat: GitHub's brand
 * guidelines apply tighter restrictions to the Octocat illustration
 * (the cat-with-tentacles mascot) than to the Mark — the Mark is
 * the asset GitHub explicitly publishes for product-integration
 * use, the Octocat is more like a brand character.
 */
export const BRAND_GITHUB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`;

/**
 * Google Drive logo (current Workspace-era multi-colour mark).
 * Six trapezoids forming the triangular logo, each filled with the
 * official Drive brand palette.
 *
 * Path data + colours verbatim from the published Drive icon asset.
 * The viewBox `0 0 87.3 78` matches the upstream geometry; the
 * `<annot-icon>` container scales it to `1em × 1em` via the
 * `width="1em" height="1em"` overrides, the same pattern every
 * other registry SVG uses.
 */
export const BRAND_GOOGLE_DRIVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 87.3 78" width="1em" height="1em" aria-hidden="true"><path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z"/><path fill="#00ac47" d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.4C.4 49.8 0 51.35 0 52.9h27.5z"/><path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.2l5.85 11.5z"/><path fill="#00832d" d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z"/><path fill="#2684fc" d="M59.7 53H27.6L13.85 76.8c1.35.8 2.9 1.2 4.5 1.2h50.6c1.6 0 3.15-.45 4.5-1.2z"/><path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.05 27.8h27.45c0-1.55-.4-3.1-1.2-4.5z"/></svg>`;
