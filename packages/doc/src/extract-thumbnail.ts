/**
 * `extractDocumentThumbnailDataUrl(doc)` — pick a thumbnail
 * candidate from an `AnnotDocument`, ready to drop into
 * `DocumentRecord.thumbnailDataUrl`. Returns the empty string
 * when the document has no usable image content (the gallery
 * card's CSS-fallback to a centered article icon kicks in).
 *
 * The implementation walks `doc.blocks` for the first
 * `ImageBlock` and string-extracts the `<image href="data:…">`
 * attribute from the block's stored SVG. We deliberately don't
 * round-trip through `DOMParser` here — the helper is Tier A
 * so it stays callable from the PWA's save pipeline / template
 * clone path / save-as-template flow without needing happy-dom.
 *
 * Today the only thumbnail strategy is "first image's data
 * URL". A future enhancement could rasterise the document's
 * first page (heading + first paragraph excerpt + image) into
 * a snapshot card, but that needs canvas (Tier C) and is out
 * of scope for the stop-the-black-rectangle fix this helper
 * answers.
 */

import type { AnnotDocument } from "./types.js";

/**
 * Return the first `data:`-URL `<image href>` found among the
 * document's image blocks, or the empty string when no image
 * block (or no `data:` href) is present.
 *
 * The matched URL is the `<image>` element's bitmap source —
 * the same bytes the editor displays under the annotation
 * overlay. Using it as the gallery thumbnail gives a
 * recognisable preview of the document's first screenshot.
 */
export function extractDocumentThumbnailDataUrl(doc: AnnotDocument): string {
  for (const block of doc.blocks) {
    // Phase 4 of card-procedure-template — step blocks carry an
    // image with the same `<image href="data:...">` shape as
    // standalone image blocks. Walking both kinds means a card-
    // procedure document (which may have no `image` blocks at
    // all) still gets a useful gallery thumbnail.
    if (block.kind !== "image" && block.kind !== "step") continue;
    const dataUrl = firstDataUrlInSvg(block.svg);
    if (dataUrl) return dataUrl;
  }
  return "";
}

/** Match `href="data:..."` or `xlink:href="data:..."` on the
 *  first `<image>` element in an SVG fragment. Tolerant of
 *  attribute order (the format spec doesn't pin the `href`
 *  attribute's position) and either quote style. */
function firstDataUrlInSvg(svg: string): string {
  // Restrict the regex to the first `<image …>` opener so we
  // don't accidentally match a `data:` URL embedded later in
  // the SVG (e.g. a future `pattern` fill referencing a
  // bitmap). Group 1 captures the URL.
  const imageOpener = /<image\b[^>]*?\b(?:xlink:)?href=("|')(data:[^"']+)\1[^>]*>/i;
  const match = svg.match(imageOpener);
  return match?.[2] ?? "";
}
