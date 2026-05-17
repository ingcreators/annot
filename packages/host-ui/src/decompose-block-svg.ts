/**
 * `decomposeBlockSvg(svg)` — split a doc image-block's embedded SVG
 * into the parts a gallery `ImageRecord` needs:
 *
 *   - `originalDataUrl` — the base bitmap `<image href>`.
 *   - `annotationsSvg` — a flat full `<svg>...</svg>` carrying just
 *     the annotation children (no base `<image>`, no
 *     `<g id="annotations">` wrapper). Same shape as
 *     `exportAnnotationsSVGString` produces, so it round-trips
 *     symmetrically with `ImageRecord.annotationsSvg` and survives
 *     `createCardDocumentFromImages` re-embedding.
 *   - `width` / `height` — pixel dimensions, picked from the base
 *     `<image>` element (with viewBox / root attrs as fallbacks).
 *
 * Phase 2 of `card-document-image-gallery-link-sync.md`. The inverse
 * of `synthesiseRecord` in `annot-doc-image-editor-modal.ts` — that
 * one builds an `EditorShell` input from the doc block (preserves
 * the full SVG including base image as `annotationsSvg` because
 * `mountFromRecord` + `restoreAnnotations` tolerate both forms);
 * this helper produces the storage-side shape where base bitmap
 * and annotations are explicitly separated.
 *
 * Tier C — uses `DOMParser` / `XMLSerializer`. Lives in host-ui
 * because it's only used during the doc → gallery sync path, which
 * is itself Tier C.
 */

export interface BlockSvgParts {
  /** Base bitmap data URL extracted from the base `<image href>`.
   *  Empty string when the block carries no base image (image-less
   *  step blocks return `svg: ""` upstream — callers should skip
   *  decomposition for those). */
  readonly originalDataUrl: string;
  /** Flat `<svg>...</svg>` carrying annotation children only. The
   *  shape matches what the editor's `exportAnnotationsSVGString`
   *  produces, so writing it to `ImageRecord.annotationsSvg` is a
   *  drop-in update — re-embedding into a fresh card document via
   *  `createCardDocumentFromImages` produces byte-equivalent
   *  output. */
  readonly annotationsSvg: string;
  /** Pixel width — picked from the base `<image width>`, then the
   *  outer `<svg width>`, then the viewBox third coord. Defaults to
   *  the upstream fallback when none resolve. */
  readonly width: number;
  /** Pixel height — mirror of `width`. */
  readonly height: number;
}

/** Decompose a doc image-block's embedded SVG into the parts an
 *  `ImageRecord` round-trip needs. Returns conservative defaults
 *  (800 × 600 dimensions, empty bitmap) on parse failure so callers
 *  can detect "no useful data" via `originalDataUrl === ""`.
 *
 *  The annotation-children extraction mirrors
 *  `normaliseAnnotationsFragment` in
 *  `gallery/create-card-document.ts:154` — same allow / deny logic
 *  for `defs` / base image / `ui-overlay` / redact-style markers. */
export function decomposeBlockSvg(svg: string): BlockSvgParts {
  if (svg.length === 0) {
    return { originalDataUrl: "", annotationsSvg: "", width: 0, height: 0 };
  }
  let root: Element | null = null;
  try {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    root = parsed.documentElement;
    if (!root || root.querySelector("parsererror")) {
      return { originalDataUrl: "", annotationsSvg: "", width: 0, height: 0 };
    }
  } catch {
    return { originalDataUrl: "", annotationsSvg: "", width: 0, height: 0 };
  }
  const baseImage = pickBaseImage(root);
  const href = baseImage?.getAttribute("href") ?? baseImage?.getAttribute("xlink:href") ?? "";
  const width = pickInt(
    baseImage?.getAttribute("width"),
    root.getAttribute("width"),
    parseViewBoxAxis(root.getAttribute("viewBox"), 2),
    800,
  );
  const height = pickInt(
    baseImage?.getAttribute("height"),
    root.getAttribute("height"),
    parseViewBoxAxis(root.getAttribute("viewBox"), 3),
    600,
  );
  const annotationsSvg = buildFlatAnnotationsSvg(root, width, height, baseImage);
  return { originalDataUrl: href, annotationsSvg, width, height };
}

/** Pick the BASE bitmap `<image>` — the first one without
 *  `data-redact-style`. Redact-style overlays (`mosaic` / `blur`)
 *  are themselves annotations and stay inside the annotation
 *  fragment. */
function pickBaseImage(root: Element): Element | null {
  const annoGroup = root.querySelector('[id="annotations"]');
  // First search outside any `<g id="annotations">` (canonical form
  // has the base image as a direct child of the root). Fall back to
  // the first non-redact `<image>` anywhere if the doc was hand-
  // authored with non-canonical nesting.
  for (const img of Array.from(root.querySelectorAll("image"))) {
    if (annoGroup?.contains(img)) continue;
    if (img.hasAttribute("data-redact-style")) continue;
    return img;
  }
  for (const img of Array.from(root.querySelectorAll("image"))) {
    if (img.hasAttribute("data-redact-style")) continue;
    return img;
  }
  return null;
}

/** Build the storage-shape `annotationsSvg`: a flat `<svg>` whose
 *  children are the annotation elements, with the base bitmap and
 *  `<g id="annotations">` wrapper stripped.
 *
 *  Mirrors `exportAnnotationsSVGString` in `editor/src/export.ts`:
 *  same width / height stamping on the root, same omission of the
 *  base image, same flattening of the annotations group. */
function buildFlatAnnotationsSvg(
  root: Element,
  width: number,
  height: number,
  baseImage: Element | null,
): string {
  const doc = root.ownerDocument;
  if (!doc) return "";
  const SVG_NS = "http://www.w3.org/2000/svg";
  // Clone so we can mutate without disturbing the caller's parse
  // result (we read attributes off `root` after this).
  const clone = root.cloneNode(true) as Element;
  // Drop the base image (matched by reference position via attribute
  // equality — we don't have the cloned reference directly).
  if (baseImage) {
    for (const img of Array.from(clone.querySelectorAll("image"))) {
      const sameHref =
        img.getAttribute("href") === baseImage.getAttribute("href") &&
        img.getAttribute("xlink:href") === baseImage.getAttribute("xlink:href");
      const sameRedactState =
        img.hasAttribute("data-redact-style") === baseImage.hasAttribute("data-redact-style");
      if (sameHref && sameRedactState) {
        img.remove();
        break;
      }
    }
  }
  // Flatten `<g id="annotations">`.
  const annoGroup = clone.querySelector('[id="annotations"]');
  if (annoGroup) {
    const parent = annoGroup.parentNode;
    if (parent) {
      while (annoGroup.firstChild) {
        parent.insertBefore(annoGroup.firstChild, annoGroup);
      }
      annoGroup.remove();
    }
  }
  // Drop UI chrome if any leaked into the saved SVG.
  clone.querySelector("#ui-overlay")?.remove();
  // Stamp canonical root attributes — `exportAnnotationsSVGString`
  // emits the width / height pair and an `xmlns`.
  clone.removeAttribute("style");
  clone.removeAttribute("id");
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  return new XMLSerializer().serializeToString(clone);
}

function pickInt(...candidates: (string | number | null | undefined)[]): number {
  for (const c of candidates) {
    if (c === null || c === undefined) continue;
    const n = typeof c === "number" ? c : Number.parseInt(c, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** Parse axis `i` (0/1/2/3 → x / y / w / h) out of a `viewBox`
 *  attribute. Returns `null` for missing / malformed inputs. */
function parseViewBoxAxis(viewBox: string | null, i: number): number | null {
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/\s+/).map(Number);
  if (parts.length !== 4) return null;
  const v = parts[i];
  return Number.isFinite(v) ? (v as number) : null;
}
