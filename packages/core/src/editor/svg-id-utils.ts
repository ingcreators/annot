/**
 * SVG id-rewriting helpers.
 *
 * SVG references resolve by document-scope id (`url(#id)` for paint /
 * clip-path / filter / mask, `href="#id"` / `xlink:href="#id"` for
 * `<use>` / animation links). When an annotation tree is cloned and
 * inserted into the same document — paste, scratchpad-stamp, future
 * "duplicate as template" features — naive `cloneNode(true)` keeps
 * the original ids on every clone. Two elements share an id, the
 * browser picks the FIRST one in document order, and the second
 * shape's ref points at the wrong target. Visible symptom for a
 * sticky / text-on-shape: the pasted text gets clipped against the
 * ORIGINAL shape's clipPath (located at the source position, not the
 * paste point), so the text appears blank.
 *
 * `freshenInternalIds` walks a cloned subtree, replaces every
 * descendant `id` with a fresh one, and rewrites every `url(#id)` /
 * `href="#id"` reference inside the same subtree to point at the new
 * id. References to ids OUTSIDE the subtree are left intact (the
 * original document still has them, and the rewrite would otherwise
 * silently drop the ref).
 *
 * Tier B — pure attribute manipulation, jsdom-friendly. No DOM-API
 * dependencies beyond `getAttribute` / `setAttribute` / `attributes`.
 */

import { newIdB58 } from "../utils/id.js";

/**
 * Rewrite every internal id in `root` (and its descendants) to a
 * fresh `${oldId}-<random>` and update every same-subtree `url(#id)`
 * / `href="#id"` / `xlink:href="#id"` reference accordingly. The
 * `root` element ITSELF is NOT renamed, since the caller may want
 * to keep the wrapper's identity stable; descendants are.
 *
 * No-op when the subtree carries no ids. Idempotent in the sense
 * that re-running yields different (but equally fresh) ids — the
 * caller should call this exactly once per clone.
 */
export function freshenInternalIds(root: SVGElement): void {
  // Collect old → new id mappings from descendants.
  const idMap = new Map<string, string>();
  const idAssign = (el: Element) => {
    if (el !== root) {
      const oldId = el.getAttribute("id");
      if (oldId) {
        // Slice from the END of the base58 id — UUIDv7 puts the
        // millisecond timestamp in the HIGH bits, so two calls within
        // the same millisecond share the leading characters. The
        // trailing 8 characters carry ~46 bits of randomness, which
        // is more than enough to keep two near-simultaneous freshen
        // calls (e.g. two scratchpad pastes in the same animation
        // frame) from colliding on a single ancestor's clipPath id.
        const newId = `${oldId}-${newIdB58().slice(-8)}`;
        idMap.set(oldId, newId);
        el.setAttribute("id", newId);
      }
    }
    for (const child of Array.from(el.children)) idAssign(child);
  };
  idAssign(root);
  if (idMap.size === 0) return;

  // Rewrite references in the same subtree (root + descendants).
  const URL_RE = /url\(#([^)]+)\)/g;
  const rewriteAttr = (value: string): string => {
    return value.replace(URL_RE, (whole, id) => {
      const next = idMap.get(id);
      return next ? `url(#${next})` : whole;
    });
  };
  const rewriteEl = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      const v = attr.value;
      if (v.includes("url(#")) {
        const next = rewriteAttr(v);
        if (next !== v) el.setAttribute(attr.name, next);
      } else if (
        (attr.name === "href" || attr.name === "xlink:href") &&
        v.length > 1 &&
        v.startsWith("#")
      ) {
        const next = idMap.get(v.slice(1));
        if (next) el.setAttribute(attr.name, `#${next}`);
      }
    }
    for (const child of Array.from(el.children)) rewriteEl(child);
  };
  rewriteEl(root);
}
