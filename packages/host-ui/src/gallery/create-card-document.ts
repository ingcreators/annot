/**
 * `createCardDocumentFromImages(images, options) → AnnotDocument` —
 * generator for the card-procedure flow.
 *
 * Phase 4 of `docs/plans/_done/card-procedure-template.md`. Pure / Tier
 * B-ish: imports from `@ingcreators/annot-core/storage` (for the
 * `ImageRecord` shape) and `@ingcreators/annot-doc` (for the
 * document model) but never reaches for `document` / `window` —
 * the result is a structured `AnnotDocument` the host can pass
 * straight to the doc shell.
 *
 * Phase 4 of `docs/plans/card-step-auto-numbering.md` retired
 * the old `numbering` option (and the matching `buildStepTitle`
 * pre-fill of `"Step 1"` / `"Image 1"` into the title field) in
 * favour of the CSS-counter-driven badge driven by
 * `meta.numbering.steps`. Generated documents now start with
 * step numbering ON and empty titles; users opt out / customise
 * the badge label via the Doc Settings dialog after creation.
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

export interface CreateCardDocumentOptions {
  /** Document title. Falls back to "Untitled" when empty. */
  readonly title: string;
  /** Per-step layout. Default `image-top`. */
  readonly layout?: StepLayout;
  /** Doc-level cards-per-row. `1` (or omitted) emits no
   *  `cardLayout.columns` field — single-column block flow is
   *  byte-identical to the pre-card layout. */
  readonly columns?: 1 | 2 | 3 | "auto";
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
  const title = options.title.trim() || "Untitled";
  const lang = options.lang ?? "en";

  const blocks: StepBlock[] = images.map((img) => buildStepBlockFromImage(img, layout));

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
      // Phase 4 of `docs/plans/card-step-auto-numbering.md` —
      // new card documents start with auto-numbering on so the
      // generated cards render with the Scribe-style badge from
      // first open. Users opt out / customise from Doc Settings.
      numbering: { steps: true },
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
function buildStepBlockFromImage(img: ImageRecord, layout: StepLayout): StepBlock {
  const w = Math.max(1, Math.round(img.width));
  const h = Math.max(1, Math.round(img.height));
  const id = `img-${newIdB58()}`;
  // Phase 7d-polish: `img.annotationsSvg` is a FULL `<svg>...</svg>`
  // document produced by `exportAnnotationsSVGString` (flattened —
  // no `<g id="annotations">` wrapper). Embedding it raw inside the
  // step's outer `<svg>` produced a nested-SVG structure, which
  // (a) confuses `restoreAnnotations` (it adopts the entire inner
  // `<svg>` as a single annotation), (b) makes PPTX export skip
  // annotations because `querySelector("[id='annotations']")`
  // returns null, and (c) gives annotated cards a subtly different
  // intrinsic structure than unannotated cards.
  //
  // Normalise on emit: extract the annotation element children and
  // wrap them in a fresh `<g id="annotations">` so every step's
  // structure is identical regardless of annotation state.
  const annotationsFragment = normaliseAnnotationsFragment(img.annotationsSvg);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<image href="${escapeAttrValue(img.originalDataUrl)}" width="${w}" height="${h}"/>` +
    `${annotationsFragment}` +
    "</svg>";
  return {
    kind: "step",
    id,
    svg,
    // Phase 4 of `docs/plans/card-step-auto-numbering.md` —
    // titles are empty by default. The auto-numbering badge
    // carries the step index; users author the editorial title
    // in the editor.
    title: "",
    body: "",
    layout,
  };
}

/** Phase 7d-polish: extract annotation children from an
 *  `img.annotationsSvg` payload and emit a canonical
 *  `<g id="annotations">...</g>` fragment. Handles:
 *
 *   - Empty / unparseable input → empty group.
 *   - Full `<svg>` with flat annotation children (the form
 *     `exportAnnotationsSVGString` produces) → wrap children.
 *   - Full `<svg>` with a `<g id="annotations">` already → use
 *     that group's children.
 *   - Raw `<g id="annotations">` fragment → use as-is.
 *
 *  Browser-only (uses DOMParser); host-ui is Tier C so this is
 *  fine. */
function normaliseAnnotationsFragment(raw: string): string {
  const empty = `<g id="annotations"></g>`;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return empty;
  // Direct `<g id="annotations">` fragment — already canonical.
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
  // Find the annotations source: a `<g id="annotations">` if
  // present (older / canonical form), else the SVG root's
  // children (flattened form).
  const annoGroup = root.querySelector('[id="annotations"]');
  const candidates: Element[] = [];
  if (annoGroup) {
    for (const child of Array.from(annoGroup.children)) candidates.push(child);
  } else {
    for (const child of Array.from(root.children)) {
      // Skip non-annotation elements: defs (font styles, etc.),
      // the base bitmap `<image>` (without redact-style marker —
      // mosaic / blur redacts ARE annotations even as `<image>`),
      // and the editor's ui-overlay if it ever leaks in.
      const tag = child.tagName;
      if (tag === "defs") continue;
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
