// Tier-A XML walker for sanitising the editor's saved
// `annotationsSvg` before it goes into resvg-js. Uses
// `@xmldom/xmldom` — pure JavaScript, no `globalThis.document`
// pollution at import time.
//
// Mirrors the browser-side walk in
// `packages/render/src/render-image-record.ts` (which uses
// the browser's `DOMParser` / `XMLSerializer`). The browser-side
// walker handles "in case the SVG hasn't been pre-processed";
// the editor's `exportAnnotationsSvgForIdb` strips most of these
// already, but the `<style data-annot-fonts>` block survives,
// and defensive handling of base-image-in-wrapper / `#ui-overlay`
// / `#annotations` group keeps callers safe if they hand us
// SVG from a future code path that doesn't go through
// `exportAnnotationsSvgForIdb` first.

import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from "@xmldom/xmldom";

/**
 * Strip editor-internal artefacts from a saved annotations SVG and
 * return the **inner content** (no outer `<svg>` wrapper) so the
 * caller can compose it with their own base image + outer wrapper.
 *
 * Walks the root `<svg>`'s children:
 * - `<defs>` — kept; child `<style data-annot-fonts>` removed.
 * - Top-level `<image>` with no `data-redact-style` attr — skipped
 *   (it's a base bitmap; mosaic/blur redacts also use `<image>`
 *   but carry `data-redact-style` so they survive).
 * - `<g id="ui-overlay">` — skipped.
 * - `<g id="annotations">` — children lifted into the inner XML.
 * - Everything else — passed through unchanged.
 *
 * Returns the empty string for empty / whitespace-only input so
 * the caller doesn't have to special-case it.
 */
export function sanitiseAnnotationsSvg(annotationsSvg: string): string {
  if (!annotationsSvg || annotationsSvg.trim().length === 0) {
    return "";
  }

  const parser = new DOMParser();
  let doc: XmlDocument;
  try {
    doc = parser.parseFromString(annotationsSvg, "image/svg+xml");
  } catch {
    // xmldom throws ParseError on hard-malformed input ("missing
    // root element" etc.). Treat as "nothing to render" rather than
    // propagating — the caller is composing an annotated bitmap;
    // an empty annotation overlay is recoverable, a thrown error
    // mid-batch is not.
    return "";
  }
  const root = doc.documentElement;
  if (!root) return "";

  const serializer = new XMLSerializer();
  let inner = "";

  for (let i = 0; i < root.childNodes.length; i++) {
    const node: XmlNode | null = root.childNodes.item(i);
    if (!node) continue;
    if (node.nodeType !== 1) continue; // ELEMENT_NODE
    const el = node as XmlElement;

    const tag = el.localName ?? el.tagName ?? "";

    if (tag === "defs") {
      const sanitised = sanitiseDefs(el);
      if (sanitised !== null) {
        inner += serializer.serializeToString(sanitised);
      }
      continue;
    }

    if (tag === "image") {
      const redact = el.getAttribute("data-redact-style");
      if (!redact) continue;
    }

    if (el.getAttribute("id") === "ui-overlay") continue;

    if (el.getAttribute("id") === "annotations") {
      for (let j = 0; j < el.childNodes.length; j++) {
        const child: XmlNode | null = el.childNodes.item(j);
        if (!child) continue;
        if (child.nodeType !== 1) continue;
        inner += serializer.serializeToString(child);
      }
      continue;
    }

    inner += serializer.serializeToString(el);
  }

  return inner;
}

/**
 * `<defs>` survives but the editor's `<style data-annot-fonts>`
 * block is removed. Returns the cleaned `<defs>` element ready
 * to be re-serialised, or `null` when the cleaned `<defs>` has
 * no remaining children (so the caller doesn't emit an empty
 * `<defs/>`).
 *
 * Mirrors `sanitiseRenderDefs` in
 * `packages/render/src/render-image-record.ts` — intentional
 * duplication; the rendering package is Tier-C-render (browser
 * `<canvas>`) and we can't depend on it from Tier-A code.
 */
function sanitiseDefs(defs: XmlElement): XmlElement | null {
  const clone = defs.cloneNode(true) as XmlElement;
  for (let i = clone.childNodes.length - 1; i >= 0; i--) {
    const child: XmlNode | null = clone.childNodes.item(i);
    if (!child) continue;
    if (child.nodeType !== 1) continue;
    const el = child as XmlElement;
    const elTag = el.localName ?? el.tagName ?? "";
    if (elTag === "style" && el.hasAttribute("data-annot-fonts")) {
      clone.removeChild(child);
    }
  }

  if (clone.childNodes.length === 0) return null;
  return clone;
}
