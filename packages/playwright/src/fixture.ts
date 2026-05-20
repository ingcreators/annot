// Playwright fixture composing the Phase 1 annotator into idiomatic
// `test.extend({ annotator })` form. Re-exports `test` (extended) +
// `expect` (passthrough) + the helpers so callers `import { test,
// expect } from "@ingcreators/annot-playwright"` in place of
// `@playwright/test`.

import {
  type Annotator,
  type BboxAnnotation,
  bboxAnnotationsToSvg,
  createAnnotator,
} from "@ingcreators/annot-annotator";
import { test as base } from "@playwright/test";

/**
 * Minimal Playwright `Page` surface the fixture relies on. The full
 * `@playwright/test` `Page` type is much wider, but importing it
 * directly forces our typecheck to load Playwright's full type
 * graph — fine for callers but a lot of weight for our own unit
 * tests. The structural alias below is fully compatible (a real
 * Playwright `Page` satisfies it).
 */
export interface PageLike {
  screenshot(options?: { fullPage?: boolean }): Promise<Buffer>;
}

/**
 * The Phase 1 annotator wrapped in a Playwright-aware surface.
 *
 * - `raw` is the underlying `Annotator` from
 *   `@ingcreators/annot-annotator` — escape hatch for direct
 *   `toPng` / `toSvg` calls.
 * - `annotateScreenshot` is the convenience that takes a
 *   Playwright `Page`, captures a screenshot, and overlays the
 *   caller-supplied annotation SVG.
 */
/**
 * Annotation input for `annotateScreenshot`. Either flavour works:
 *
 *   - `annotationsSvg: string` — raw SVG fragment, useful for the
 *     `rectForBoundingBox` / `arrowBetween` / `textAt` primitives
 *     and any custom SVG you compose yourself.
 *   - `annotations: BboxAnnotation[]` — the DSL flavour added in
 *     0.2.0. Each entry is a typed shape (`rect` / `circle` /
 *     `arrow` / `text` / `callout` / `raw`) with an optional
 *     `intent` shorthand mapping to design-system colours.
 */
export type AnnotateScreenshotOptions =
  | { annotationsSvg: string; annotations?: never; fullPage?: boolean }
  | { annotations: readonly BboxAnnotation[]; annotationsSvg?: never; fullPage?: boolean };

export interface PlaywrightAnnotator {
  raw: Annotator;
  annotateScreenshot(page: PageLike, opts: AnnotateScreenshotOptions): Promise<Uint8Array>;
}

/**
 * `test = base.extend({ annotator })` — drop-in replacement for
 * `@playwright/test`'s `test` with an `annotator` fixture available
 * in every test.
 */
export const test = base.extend<{ annotator: PlaywrightAnnotator }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature requires the empty destructure.
  annotator: async ({}, use) => {
    const raw = createAnnotator();
    await use({
      raw,
      annotateScreenshot: (page: PageLike, opts: AnnotateScreenshotOptions) =>
        annotateScreenshot(raw, page, opts),
    });
  },
});

/**
 * Standalone version of the fixture's `annotateScreenshot` helper
 * — exported so callers who build their own Playwright fixture
 * (e.g. with extra fixtures composed on top) can still use the
 * one-call screenshot+annotate flow.
 *
 * Accepts either an `annotationsSvg: string` (raw SVG path) or an
 * `annotations: BboxAnnotation[]` (DSL path added in 0.2.0).
 */
export async function annotateScreenshot(
  annotator: Annotator,
  page: PageLike,
  opts: AnnotateScreenshotOptions,
): Promise<Uint8Array> {
  const png = await page.screenshot({ fullPage: opts.fullPage });
  const { width, height } = readPngDimensions(png);
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  const annotationsSvg =
    "annotations" in opts && opts.annotations !== undefined
      ? bboxAnnotationsToSvg(opts.annotations)
      : (opts.annotationsSvg ?? "");
  return annotator.toPng({
    originalDataUrl: dataUrl,
    annotationsSvg,
    width,
    height,
  });
}

/**
 * Parse a PNG's IHDR chunk to extract `width` × `height`. Avoids
 * `page.viewportSize()` which returns CSS px (subject to
 * `devicePixelRatio` scaling) and doesn't match clipped or
 * full-page screenshot dimensions.
 */
function readPngDimensions(png: Buffer | Uint8Array): {
  width: number;
  height: number;
} {
  // PNG layout: 8-byte signature + 4-byte length + 4-byte type
  // ("IHDR") + 13-byte IHDR data. Width / height are the first
  // two big-endian uint32s of the IHDR data block (bytes 16..23).
  if (png.length < 24) {
    throw new Error("PNG too short to contain IHDR chunk");
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return { width, height };
}
