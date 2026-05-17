/**
 * `buildBlockSvg(parts)` — recompose a doc image-block's canonical
 * `<svg>` payload from the parts a gallery `ImageRecord` exposes.
 *
 * Phase 3 of `card-document-image-gallery-link-sync.md`. The
 * inverse of `decomposeBlockSvg` — when the shell pulls a linked
 * block, we hand it `{ originalDataUrl, annotationsSvg, width,
 * height }` (the same shape `ImageRecord` carries), and this
 * helper produces the inline-form SVG string the doc block
 * stores in `block.svg`.
 *
 * Shape matches what `createCardDocumentFromImages` and
 * `createImageBlockFromDataUrl` emit:
 *
 *   `<svg xmlns viewBox width height>`
 *     `<image href data-url width height/>`
 *     `<g id="annotations">…</g>`
 *   `</svg>`
 *
 * The annotation children come from the gallery's
 * `ImageRecord.annotationsSvg` field, which is itself a full
 * flat `<svg>...</svg>` document (produced by the editor's
 * `exportAnnotationsSVGString`). We extract the children + wrap
 * them in `<g id="annotations">` using the same normalisation
 * logic `create-card-document.ts:normaliseAnnotationsFragment`
 * applies — keep the two surfaces byte-identical so a doc that
 * round-trips through the pull path matches one generated fresh
 * from the same gallery state.
 *
 * Tier C — uses `DOMParser` / `XMLSerializer`. Browser-only.
 */

export interface BlockSvgParts {
  /** Base bitmap data URL — drop-in for the embedded
   *  `<image href>`. */
  readonly originalDataUrl: string;
  /** Annotations as a full flat `<svg>` document (no base image,
   *  no `<g id="annotations">` wrapper) — the form
   *  `exportAnnotationsSVGString` / `decomposeBlockSvg` produce.
   *  Empty string → emits an empty `<g id="annotations">`. */
  readonly annotationsSvg: string;
  /** Pixel width — written to the root `<svg>` and base `<image>`. */
  readonly width: number;
  /** Pixel height — mirror of width. */
  readonly height: number;
}

/** Compare two annotation-fragment strings for SEMANTIC equality.
 *
 *  Both inputs are full `<svg>...</svg>` documents in the form
 *  the editor's `exportAnnotationsSVGString` and
 *  `decomposeBlockSvg` produce. Direct string equality is too
 *  strict — successive `XMLSerializer` passes legitimately add
 *  redundant `xmlns` attributes to migrated children, and the
 *  outer `<svg>` may or may not carry `data-annot-version="1"`
 *  depending on which side of the doc ↔ gallery boundary
 *  produced it. We compare the annotation CHILDREN after one
 *  normalisation pass; that's stable across the round-trip
 *  that the Phase 3 pull pass relies on.
 *
 *  Critically — `<defs>` siblings are filtered out before the
 *  comparison runs. The doc generator's
 *  `normaliseAnnotationsFragment` strips `<defs>` from the
 *  embedded form (intentional — fonts are doc-supplied), so
 *  any annotation that drags `<defs>` along (gradients via
 *  `gradient-utils`, arrow markers, the editor's
 *  `data-annot-fonts` style block) would otherwise mismatch on
 *  every Phase 3 pull pass and re-toast forever. Filtering on
 *  the comparison side keeps the existing embed shape intact
 *  while making the comparison robust. */
export function annotationChildrenEqual(a: string, b: string): boolean {
  return canonicaliseChildren(a) === canonicaliseChildren(b);
}

function canonicaliseChildren(annotationsSvg: string): string {
  if (annotationsSvg.length === 0) return "";
  try {
    const parsed = new DOMParser().parseFromString(annotationsSvg, "image/svg+xml");
    const root = parsed.documentElement;
    if (root.querySelector("parsererror")) return annotationsSvg;
    const serializer = new XMLSerializer();
    return Array.from(root.children)
      .filter((c) => c.tagName !== "defs")
      .map((c) => serializer.serializeToString(c))
      .join("");
  } catch {
    return annotationsSvg;
  }
}

/** Build a canonical doc-block SVG string from gallery parts.
 *  Not byte-stable round-trip with `decomposeBlockSvg` — the
 *  `XMLSerializer` adds redundant `xmlns` on the second pass.
 *  Use `annotationChildrenEqual` for the comparison that the
 *  pull pass needs (idempotent after the first sync lands). */
export function buildBlockSvg(parts: BlockSvgParts): string {
  const w = Math.max(1, Math.round(parts.width));
  const h = Math.max(1, Math.round(parts.height));
  const annotationsFragment = normaliseAnnotationsFragment(parts.annotationsSvg);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<image href="${escapeAttrValue(parts.originalDataUrl)}" width="${w}" height="${h}"/>` +
    `${annotationsFragment}` +
    "</svg>"
  );
}

/** Normalise a gallery-side `annotationsSvg` payload into a
 *  canonical `<g id="annotations">...</g>` fragment for embedding
 *  inside a doc block's outer `<svg>`. Mirrors the same-named
 *  helper in `gallery/create-card-document.ts:154` — see that
 *  file for the historical reasoning (PPTX export consistency,
 *  redact-style overlays, structural shape parity between
 *  annotated and unannotated cards). */
function normaliseAnnotationsFragment(raw: string): string {
  const empty = `<g id="annotations"></g>`;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return empty;
  if (trimmed.startsWith("<g") && /id\s*=\s*["']annotations["']/.test(trimmed.slice(0, 80))) {
    return trimmed;
  }
  let root: Element | null = null;
  try {
    const parsed = new DOMParser().parseFromString(trimmed, "image/svg+xml");
    root = parsed.documentElement;
    if (!root || root.querySelector("parsererror")) return empty;
  } catch {
    return empty;
  }
  const annoGroup = root.querySelector('[id="annotations"]');
  const candidates: Element[] = [];
  if (annoGroup) {
    for (const child of Array.from(annoGroup.children)) candidates.push(child);
  } else {
    for (const child of Array.from(root.children)) {
      const tag = child.tagName;
      // <defs> — preserve content (gradients, markers) so the
      // annotation's id refs still resolve in-doc. Strip only
      // the editor's `data-annot-fonts` style block. Mirrors the
      // same logic in `gallery/create-card-document.ts`.
      if (tag === "defs") {
        const sanitised = sanitiseAnnotationDefs(child);
        if (sanitised) candidates.push(sanitised);
        continue;
      }
      // Skip the base image but preserve mosaic / blur redact
      // overlays — they are themselves annotations even though
      // they use `<image>`.
      if (tag === "image" && !child.hasAttribute("data-redact-style")) continue;
      if (child.id === "ui-overlay") continue;
      candidates.push(child);
    }
  }
  if (candidates.length === 0) return empty;
  const serializer = new XMLSerializer();
  const inner = candidates.map((el) => serializer.serializeToString(el)).join("");
  return `<g id="annotations">${inner}</g>`;
}

/** Strip the editor's `data-annot-fonts` style block from a
 *  cloned `<defs>`. Returns `null` when the result has no
 *  meaningful content left. See `gallery/create-card-document.ts`
 *  for the rationale (font defs would conflict with the doc's
 *  own fonts; everything else — gradients, markers — must survive). */
function sanitiseAnnotationDefs(defs: Element): Element | null {
  const clone = defs.cloneNode(true) as Element;
  for (const fontStyle of Array.from(clone.querySelectorAll("style[data-annot-fonts]"))) {
    fontStyle.remove();
  }
  if (clone.children.length === 0 && (clone.textContent ?? "").trim().length === 0) return null;
  return clone;
}

function escapeAttrValue(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
