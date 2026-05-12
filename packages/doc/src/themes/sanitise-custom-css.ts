/**
 * Phase 5 of `docs/plans/card-document-themes.md` — sanitiser
 * for user-supplied custom CSS appended to a document's style
 * block via `meta.appearance.customCss`.
 *
 * The sanitiser strips constructs that could leak data to a
 * third party or exceed the format's size budget:
 *
 *   - `@import` rules (no external CSS loading; defeats the
 *     "self-contained `.annot.html` file" guarantee).
 *   - `url(http://…)` and `url(https://…)` references —
 *     would let an embedded background image phone home as a
 *     tracking pixel. `url(data:…)` is allowed (embedded
 *     bytes, no network egress).
 *   - `behavior: url(…)` legacy IE-only constructs that could
 *     execute HTC scripts in old browsers.
 *   - Anything longer than 8 KB after the above strips — hard
 *     cap on `<style>` bloat. Truncation is byte-aligned and
 *     leaves a trailing `/* ...truncated *\/` comment so the
 *     dialog can warn the user.
 *
 * Pure / Tier A — no DOM dependency, no I/O. Round-trip stable:
 * sanitising an already-sanitised string is a no-op.
 *
 * NOTE: the sanitiser uses regex matching rather than a full
 * CSS parser. CSS's permissive syntax means a sufficiently
 * adversarial input could smuggle past these regex rules — the
 * defence in depth is the `<style>` element's HTML containment
 * (no JS execution) combined with the fact that the document
 * author IS the user opening it most of the time. The regex
 * pass is the FIRST line of defence, not the only one.
 */

/** Hard byte cap for custom CSS after sanitisation. Matches
 *  the limit documented in `docs/plans/card-document-themes.md`
 *  Phase 5 section. */
export const CUSTOM_CSS_MAX_BYTES = 8192;

/** Trailing marker appended when the sanitiser truncates the
 *  input. The dialog's warning UI looks for this exact substring
 *  to display a "Your CSS was truncated" message. */
export const CUSTOM_CSS_TRUNCATION_MARKER = "/* annot:truncated */";

export interface SanitiseResult {
  /** Sanitised CSS, ready to drop into the style block. */
  readonly css: string;
  /** Human-readable list of what got stripped or transformed.
   *  Empty when the input is already clean. Each entry is a
   *  short sentence the dialog can render verbatim. */
  readonly warnings: readonly string[];
}

/** Sanitise a custom-CSS string. Returns the cleaned bytes
 *  alongside a list of human-readable warnings about what got
 *  stripped. Pure; the function returns frozen arrays so
 *  callers can pass the result around without copying. */
export function sanitiseCustomCss(raw: string): SanitiseResult {
  if (typeof raw !== "string" || raw.length === 0) {
    return { css: "", warnings: [] };
  }
  const warnings: string[] = [];
  let css = raw;

  // 1. Reject @import. The semicolon-OR-string-OR-url() ending
  //    is permissive on purpose — CSS imports come in a few
  //    flavours (url, plain string, with media queries) and we
  //    don't want any of them to survive.
  const importMatches = css.match(/@import\b[^;]*;?/gi);
  if (importMatches && importMatches.length > 0) {
    warnings.push(
      `Removed ${importMatches.length} @import rule${importMatches.length === 1 ? "" : "s"} (external CSS loading is disabled).`,
    );
    css = css.replace(/@import\b[^;]*;?/gi, "");
  }

  // 2. Reject legacy `behavior: url(...)` HTC injection.
  const behaviorMatches = css.match(/\bbehavior\s*:\s*url\s*\([^)]*\)\s*;?/gi);
  if (behaviorMatches && behaviorMatches.length > 0) {
    warnings.push(
      `Removed ${behaviorMatches.length} behavior: url() declaration${behaviorMatches.length === 1 ? "" : "s"} (legacy IE-only construct, security risk).`,
    );
    css = css.replace(/\bbehavior\s*:\s*url\s*\([^)]*\)\s*;?/gi, "");
  }

  // 3. Strip external url() references. Allow `data:` URLs
  //    (embedded bytes, no network egress).
  const urlExternalRegex = /url\s*\(\s*(?:["']?)\s*(?:https?:|\/\/)[^)]*\)/gi;
  const urlMatches = css.match(urlExternalRegex);
  if (urlMatches && urlMatches.length > 0) {
    warnings.push(
      `Removed ${urlMatches.length} external url() reference${urlMatches.length === 1 ? "" : "s"} (could phone home; use data: URLs instead).`,
    );
    css = css.replace(urlExternalRegex, "none");
  }

  // 4. Hard cap on length. Truncate at 8 KB minus the marker
  //    length so the marker fits inside the cap.
  if (css.length > CUSTOM_CSS_MAX_BYTES) {
    const room = CUSTOM_CSS_MAX_BYTES - CUSTOM_CSS_TRUNCATION_MARKER.length - 1;
    css = `${css.slice(0, room)}\n${CUSTOM_CSS_TRUNCATION_MARKER}`;
    warnings.push(
      `Truncated to ${CUSTOM_CSS_MAX_BYTES} bytes (your CSS exceeded the format's hard cap).`,
    );
  }

  return Object.freeze({
    css,
    warnings: Object.freeze(warnings),
  });
}

/** Convenience wrapper for callers that only care about the
 *  cleaned bytes. Equivalent to `sanitiseCustomCss(raw).css`. */
export function sanitiseCustomCssText(raw: string): string {
  return sanitiseCustomCss(raw).css;
}
