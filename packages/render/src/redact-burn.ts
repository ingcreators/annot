/**
 * Burn redactions into a base bitmap.
 *
 * Phase 1 of [`docs/plans/redact-burn-into-image.md`](../../../docs/plans/redact-burn-into-image.md).
 *
 * Today's redact tool is overlay-only: solid / mosaic / blur each
 * render an SVG element on top of the base `<image>` while the
 * underlying bitmap stays pristine. That means anyone with the saved
 * file can strip the redact element and recover the original pixels.
 * This helper is the first half of the privacy-driven "make this
 * permanent" action — given the loaded base image and the document's
 * redact element list, it produces a new PNG blob with every redact
 * region composited onto the base at native resolution. The host's
 * orchestration layer (`EditorShell.applyAllRedactions`, Phase 2)
 * replaces the loaded `ImageRecord`'s `originalDataUrl` with the
 * resulting bytes, so the saved file no longer carries the
 * recoverable original under the redactions.
 *
 * Tier C-render: pure data-driven `(base, redactEls) → blob`. No
 * `CanvasManager`, no live editor session, no `annot-editor`
 * dependency. The redact elements are read positionally via their
 * `x` / `y` / `width` / `height` attributes (the move-bakes-coordinates
 * invariant guarantees those reflect the visual position for
 * unrotated shapes); mosaic / blur PNGs are pulled straight from
 * the element's `href` (PR2 ensures these stay in sync with the
 * geometry after move + resize).
 *
 * Phase 4 of the same plan extends the helper to honour `data-rot`
 * / `data-flip-h` / `data-flip-v` — the exact attribute set
 * `transform-utils.ts` writes via `applyTransformState`. The
 * renderer applies the same matrix `T(cx,cy) * R(rot) * S(sx,sy)
 * * T(-cx,-cy)` to the canvas context before drawing each rect /
 * image, so a 45°-rotated solid bar covers its rotated bounds and
 * a flipped mosaic / blur composites onto the mirrored region.
 * The pivot is the element's local bbox center
 * `(x + w/2, y + h/2)`, matching `transform-utils`'
 * geometry-positioned-element pivot.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Classifier outcome for one element of the redact list. */
export type RedactKind = "solid" | "mosaic" | "blur";

/** A redact element classified into the burn pipeline. */
interface ClassifiedRedact {
  kind: RedactKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation in degrees (CW positive), as written by
   *  `transform-utils.ts` to `data-rot`. Zero for axis-aligned
   *  redactions. The renderer applies `R(rotation)` around the
   *  element's local bbox center before drawing. */
  rotation: number;
  /** Horizontal flip flag (`data-flip-h="1"`). The renderer
   *  applies `S(-1, 1)` around the bbox center before drawing
   *  when set. */
  flipH: boolean;
  /** Vertical flip flag (`data-flip-v="1"`). The renderer
   *  applies `S(1, -1)` around the bbox center before drawing
   *  when set. */
  flipV: boolean;
  /** Solid fill color (only set when `kind === "solid"`). */
  fill?: string;
  /** Embedded PNG data URL (only set when `kind === "mosaic"` or `"blur"`). */
  href?: string;
}

/**
 * Burn every redact element into the base bitmap.
 *
 * @param base   Loaded base image — must have decoded pixels available
 *               (`HTMLImageElement.complete === true` or an `ImageBitmap`).
 * @param redactEls Redact SVG elements in DOM order. Each element's
 *               `data-redact-style` attribute selects the dispatch
 *               (`solid` → `<rect>`-style flat fill; `mosaic` / `blur`
 *               → `<image>`-style PNG composite).
 *
 * Returns a PNG `Blob` at the base's natural dimensions. Callers
 * convert to a data-URL via `FileReader` / `URL.createObjectURL`
 * as needed (keeping the helper format-agnostic so future Node /
 * Playwright integrations don't get coupled to the browser's
 * data-URL pipeline).
 *
 * The function is a no-op for an empty redact list — it still
 * returns a blob (a clean re-encode of the base) so callers don't
 * have to special-case "nothing to do."
 */
export async function burnRedactionsIntoBitmap(
  base: HTMLImageElement | ImageBitmap,
  redactEls: SVGElement[],
): Promise<Blob> {
  const width = naturalWidth(base);
  const height = naturalHeight(base);
  if (width <= 0 || height <= 0) {
    throw new Error(
      `burnRedactionsIntoBitmap: base bitmap has zero dimension (${width}×${height})`,
    );
  }

  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const ctx = off.getContext("2d");
  if (!ctx) {
    throw new Error("burnRedactionsIntoBitmap: 2D canvas context unavailable");
  }

  ctx.drawImage(base, 0, 0, width, height);

  for (const el of redactEls) {
    const classified = classifyRedact(el);
    if (!classified) continue;
    await compositeOne(ctx, classified);
  }

  return new Promise<Blob>((resolve, reject) => {
    off.toBlob((blob) => {
      if (!blob) {
        reject(new Error("burnRedactionsIntoBitmap: canvas.toBlob produced null"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

/**
 * Classify an SVG element as a redact variant + extract the geometry
 * + the per-variant payload. Returns `null` if the element doesn't
 * carry a recognised `data-redact-style` value, so the caller can
 * skip non-redact elements that may sneak through (e.g. a stale
 * sibling in the annotations group).
 *
 * Exported for unit-testing the dispatch logic against synthetic
 * SVG fixtures without standing up a real canvas.
 */
export function classifyRedact(el: SVGElement): ClassifiedRedact | null {
  const style = el.getAttribute("data-redact-style");
  if (style !== "solid" && style !== "mosaic" && style !== "blur") {
    return null;
  }
  const x = parseAttrNumber(el, "x");
  const y = parseAttrNumber(el, "y");
  const width = parseAttrNumber(el, "width");
  const height = parseAttrNumber(el, "height");
  if (width <= 0 || height <= 0) return null;

  // Phase 4: read rotation / flip from the data-attrs that
  // `transform-utils.ts:writeTransformState` persists. Inlined here
  // (instead of importing `readTransformState` from
  // `@ingcreators/annot-core/editor/transform-utils`) so the
  // renderer doesn't pull in arrow-markers / text-utils transitively
  // for what is just three attribute reads. The schema is
  // documented in `transform-utils.ts:readTransformState`; the
  // attribute names are the contract this read shares with that
  // helper.
  const rotation = parseAttrNumber(el, "data-rot");
  const flipH = el.getAttribute("data-flip-h") === "1";
  const flipV = el.getAttribute("data-flip-v") === "1";

  if (style === "solid") {
    const fill = el.getAttribute("fill") || "#000";
    return { kind: "solid", x, y, width, height, rotation, flipH, flipV, fill };
  }
  // mosaic / blur both ride on an <image> with the baked PNG.
  const href = el.getAttribute("href") || el.getAttributeNS(XLINK_NS, "href") || "";
  if (!href) return null;
  return { kind: style, x, y, width, height, rotation, flipH, flipV, href };
}

const XLINK_NS = "http://www.w3.org/1999/xlink";

function parseAttrNumber(el: SVGElement, name: string): number {
  const raw = el.getAttribute(name);
  if (!raw) return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

async function compositeOne(
  ctx: CanvasRenderingContext2D,
  el: ClassifiedRedact,
): Promise<void> {
  // For mosaic / blur we need the embedded PNG decoded BEFORE the
  // transform stack opens — happy-dom `Image` decoding is async, so
  // resolving it after `ctx.save()` would push the restore() out of
  // the natural matched-pair scope. Decode first, then transform-
  // wrap the synchronous drawImage call.
  let img: HTMLImageElement | null = null;
  if (el.kind !== "solid") {
    const href = el.href;
    if (!href) return;
    img = await loadImage(href);
  }

  ctx.save();
  applyElementTransform(ctx, el);
  if (el.kind === "solid") {
    ctx.fillStyle = el.fill ?? "#000";
    ctx.fillRect(el.x, el.y, el.width, el.height);
  } else if (img) {
    ctx.drawImage(img, el.x, el.y, el.width, el.height);
  }
  ctx.restore();
}

/**
 * Apply the element's rotation + flip to the canvas context.
 *
 * Mirrors `transform-utils.ts:applyTransformState` for the
 * geometry-positioned redact subset (`<rect>` for solid,
 * `<image>` for mosaic / blur). The pivot is the element's local
 * bbox center `(x + w/2, y + h/2)`; `tx` / `ty` are always zero
 * for these elements (the move-bakes-coordinates invariant lives
 * in geometry attrs, not in a translate transform).
 *
 * Composite math (right-to-left in canvas, left-to-right in
 * SVG matrix terms — same operator order):
 *   M = T(cx, cy) * R(rotation) * S(sx, sy) * T(-cx, -cy)
 *
 * Identity case (no rotation, no flip) skips the transform stack
 * entirely so the Phase 1 axis-aligned fast path stays intact.
 */
function applyElementTransform(
  ctx: CanvasRenderingContext2D,
  el: ClassifiedRedact,
): void {
  const isIdentity = el.rotation === 0 && !el.flipH && !el.flipV;
  if (isIdentity) return;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const sx = el.flipH ? -1 : 1;
  const sy = el.flipV ? -1 : 1;
  ctx.translate(cx, cy);
  if (el.rotation !== 0) ctx.rotate((el.rotation * Math.PI) / 180);
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  ctx.translate(-cx, -cy);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`burnRedactionsIntoBitmap: failed to load redact image (${e})`));
    img.src = src;
  });
}

function naturalWidth(b: HTMLImageElement | ImageBitmap): number {
  return "naturalWidth" in b ? b.naturalWidth : b.width;
}

function naturalHeight(b: HTMLImageElement | ImageBitmap): number {
  return "naturalHeight" in b ? b.naturalHeight : b.height;
}

// `SVG_NS` is exported only to keep tests self-documenting. Not part
// of the public API of `@ingcreators/annot-render`.
export const _internal = { SVG_NS };
