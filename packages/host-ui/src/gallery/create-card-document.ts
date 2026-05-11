/**
 * `createCardDocumentFromImages(images, options) → AnnotDocument` —
 * generator for the card-procedure flow.
 *
 * Phase 4 of `docs/plans/card-procedure-template.md`. Pure / Tier
 * B-ish: imports from `@ingcreators/annot-core/storage` (for the
 * `ImageRecord` shape) and `@ingcreators/annot-doc` (for the
 * document model) but never reaches for `document` / `window` —
 * the result is a structured `AnnotDocument` the host can pass
 * straight to the doc shell.
 *
 * Inputs:
 *
 *   - `images`: the user's ordered selection (`getSelection().
 *     imagesInOrder` from `<annot-gallery-page>`).
 *   - `options`:
 *       - `title`: doc title + `meta.title`.
 *       - `layout`: per-step `data-step-layout`. Stored on each
 *         block, also stamped on `meta.cardLayout.defaultStepLayout`
 *         when it differs from the implicit default so new steps
 *         inserted later inherit the user's choice.
 *       - `columns`: doc-level `cardLayout.columns`. Optional
 *         (default `1` → no field emitted).
 *       - `numbering`: optional pre-fill strategy for step
 *         titles. `"step-n"` produces `"Step 1"` / `"Step 2"` /
 *         …, `"image-n"` produces `"Image 1"` / …, `"none"`
 *         leaves titles empty. The user can always retitle each
 *         step after open.
 *
 * Each input image becomes one `StepBlock` in document order;
 * the block's `id` matches the image's source `path` slug (so
 * `imageMeta` survives later editing), and the embedded SVG
 * wraps the original bitmap + the existing annotation tree.
 */

import { newIdB58 } from "@ingcreators/annot-core";
import type { ImageRecord } from "@ingcreators/annot-core/storage";
import type { AnnotDocument, CardLayoutMeta, StepBlock, StepLayout } from "@ingcreators/annot-doc";
import { ANNOT_DOC_VERSION } from "@ingcreators/annot-doc";

export type CardDocumentNumbering = "none" | "step-n" | "image-n";

export interface CreateCardDocumentOptions {
  /** Document title. Falls back to "Untitled" when empty. */
  readonly title: string;
  /** Per-step layout. Default `image-top`. */
  readonly layout?: StepLayout;
  /** Doc-level cards-per-row. `1` (or omitted) emits no
   *  `cardLayout.columns` field — single-column block flow is
   *  byte-identical to the pre-card layout. */
  readonly columns?: 1 | 2 | 3 | "auto";
  /** Title-prefill strategy. Default `"step-n"`. */
  readonly numbering?: CardDocumentNumbering;
  /** Document language (BCP-47). Default `"en"`. */
  readonly lang?: string;
}

/** Stamp a fresh `AnnotDocument` carrying one step block per
 *  source image in input order. */
export function createCardDocumentFromImages(
  images: readonly ImageRecord[],
  options: CreateCardDocumentOptions,
): AnnotDocument {
  const layout: StepLayout = options.layout ?? "image-top";
  const columns = options.columns;
  const numbering: CardDocumentNumbering = options.numbering ?? "step-n";
  const title = options.title.trim() || "Untitled";
  const lang = options.lang ?? "en";

  const blocks: StepBlock[] = images.map((img, i) =>
    buildStepBlockFromImage(img, i, layout, numbering),
  );

  // cardLayout is emitted iff it differs from the implicit
  // default (`columns: 1`, `defaultStepLayout: "image-top"`).
  // Otherwise the empty-object form would round-trip through
  // `parseCardLayoutMeta` as `undefined` anyway — keep the
  // sidecar minimal.
  const cardLayout: CardLayoutMeta = {
    ...(columns !== undefined && columns !== 1 ? { columns } : {}),
    ...(layout !== "image-top" ? { defaultStepLayout: layout } : {}),
  };
  const cardLayoutMaybe = Object.keys(cardLayout).length > 0 ? { cardLayout } : {};

  return {
    version: ANNOT_DOC_VERSION,
    lang,
    title,
    meta: {
      title,
      ...cardLayoutMaybe,
    },
    styleBlock: null,
    blocks,
  };
}

/** Build the canonical inner SVG content for a step image. The
 *  shape mirrors what `createImageBlockFromAnnotMeta` produces
 *  (single-line `<svg>` with the bitmap + annotations group) —
 *  consistent with how XMP-extracted images flow into the doc
 *  shell. */
function buildStepBlockFromImage(
  img: ImageRecord,
  index: number,
  layout: StepLayout,
  numbering: CardDocumentNumbering,
): StepBlock {
  const w = Math.max(1, Math.round(img.width));
  const h = Math.max(1, Math.round(img.height));
  const id = `img-${newIdB58()}`;
  // Use the image's existing annotations if present; fall back
  // to an empty group so the editor's restore path has
  // something to mount into.
  const annotationsFragment = img.annotationsSvg.trim() || `<g id="annotations"></g>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<image href="${escapeAttrValue(img.originalDataUrl)}" width="${w}" height="${h}"/>` +
    `${annotationsFragment}` +
    "</svg>";
  return {
    kind: "step",
    id,
    svg,
    title: buildStepTitle(index, numbering),
    body: "",
    layout,
  };
}

function buildStepTitle(index: number, numbering: CardDocumentNumbering): string {
  switch (numbering) {
    case "step-n":
      return `Step ${index + 1}`;
    case "image-n":
      return `Image ${index + 1}`;
    default:
      return "";
  }
}

/** Inline copy of `escapeAttrValue` from `create-image-block.ts`
 *  in `@ingcreators/annot-doc`. Kept local so this Tier C-ish
 *  helper doesn't need to pull a private export across the
 *  package boundary. */
function escapeAttrValue(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
