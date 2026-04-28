/**
 * Brand-glyph SVG strings used by the storage chip in the gallery
 * sidebar.
 *
 * Today the only brand-mark we ship is GitHub's; Google Drive uses
 * Material Symbols' `add_to_drive` glyph instead so the storage
 * chip rail stays uniformly monochrome (the official multi-colour
 * Drive logo would clash with every adjacent monochrome icon and
 * skew the visual hierarchy in the sidebar). When a Drive
 * integration needs the official multi-colour mark — e.g. an
 * "Open in Drive" CTA, the Workspace Marketplace listing — that
 * usage will live in its own asset, NOT here, since the trade-off
 * (theme-locked colours) only makes sense in dedicated brand
 * surfaces.
 *
 * **Trademark notice.** "GitHub" and the GitHub Mark are trademarks
 * of GitHub, Inc. The path data below is the official mark provided
 * by GitHub for indicating product integration; we render it
 * unmodified to comply with their brand guidelines:
 *
 *   GitHub Logos & Usage: https://github.com/logos
 *
 * Specifically:
 *
 * 1. Geometry is verbatim from the published mark — no scaling
 *    distortion, no path mutation. The `viewBox` matches the
 *    upstream asset (16×16).
 * 2. The Mark uses `fill="currentColor"`, which is the monochrome
 *    usage GitHub explicitly permits in their guidelines ("you may
 *    render the mark in any colour that contrasts with its
 *    background"). This keeps the icon theme-aware in the sidebar
 *    without violating the "do not modify" rule — we are choosing a
 *    permitted fill colour, not editing the mark.
 *
 * If GitHub updates their published mark in a way that supersedes
 * the path data here, mirror the upstream change in this file —
 * never patch a stale mark in place.
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
