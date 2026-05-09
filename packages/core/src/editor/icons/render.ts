/**
 * Icon renderer — converts an `IconSpec` into a string of SVG /
 * `<img>` markup ready to inject into the host DOM.
 *
 * Phase 3 of `docs/plans/svg-icons-and-plugin-icon-spec.md`.
 *
 * Tier-B placement: produces a string + Element via DOMParser;
 * jsdom-friendly. Works in pure-Node tests, web bundles, and the
 * extension's MV3 worker context (the latter only renders
 * registry-backed icons, not plugin SVG; the sanitiser bails out
 * cleanly when DOMParser is unavailable).
 */

import type { IconSpec } from "../../icons/types.js";
import { resolveBuiltinIcon } from "./registry.js";
import { sanitizeIconSvg } from "./sanitize.js";

/** Same-origin-or-data validity check for `kind: "url"`. We
 *  accept root-relative paths (`/icons/foo.svg`), schemeless
 *  paths (`./foo.svg`), and `data:image/svg+xml` URLs. We reject
 *  everything with an absolute external scheme (`https://`,
 *  `http://`, `ftp://`, …), which keeps a plugin from leaking
 *  user activity to a third-party origin via image fetch. */
function isSafeIconUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  if (/^data:image\/svg\+xml[,;]/i.test(trimmed)) return true;
  if (/^javascript:/i.test(trimmed)) return false;
  if (/^data:/i.test(trimmed)) return false; // data: URLs other than svg+xml rejected
  // Reject any explicit-scheme URL except the `data:image/svg+xml`
  // one already handled above.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  return true;
}

/**
 * Render an `IconSpec` as a string of HTML markup. Returns the
 * empty string for an unrenderable spec — unknown builtin id,
 * unparseable plugin SVG, unsafe URL — so consumers get a
 * predictable "no icon" output rather than `null` / exceptions.
 *
 * `kind: "url"` is rendered as `<img>` so the SVG content runs
 * in image-document context — sandboxed away from the host's
 * CSS and JS. Plugins that need theme-aware `currentColor`
 * icons should use `kind: "svg"` instead.
 */
export function renderIconHtml(spec: IconSpec): string {
  switch (spec.kind) {
    case "builtin": {
      const svg = resolveBuiltinIcon(spec.id);
      return svg ?? "";
    }
    case "svg": {
      const sanitised = sanitizeIconSvg(spec.svg);
      return sanitised ?? "";
    }
    case "url": {
      if (!isSafeIconUrl(spec.url)) return "";
      // The double-quoted URL must not break out of the attribute.
      // Replace `"` with `&quot;` defensively even though our
      // safe-URL check already rejected javascript: / vbscript:.
      const escaped = spec.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      return `<img src="${escaped}" alt="" aria-hidden="true" class="annot-icon-img"/>`;
    }
  }
}

/**
 * Convenience: parse the rendered HTML back into a live element
 * for direct DOM insertion. Use this when the consumer is
 * imperative DOM code; Lit consumers should pass the string
 * through `unsafeHTML` / `<annot-icon>` instead.
 *
 * Returns `null` for an empty render output.
 */
export function renderIconElement(spec: IconSpec, doc?: Document): Element | null {
  const html = renderIconHtml(spec);
  if (!html) return null;
  const ownerDoc = doc ?? (globalThis as unknown as { document?: Document }).document ?? null;
  if (!ownerDoc) return null;
  const tpl = ownerDoc.createElement("template");
  tpl.innerHTML = html;
  // The first child is the rendered <svg> or <img>.
  return (tpl.content.firstElementChild as Element | null) ?? null;
}
