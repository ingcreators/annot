// Playwright `page.screenshot({ annot: { … } })` fixture.
//
// Phase 1 of `docs/plans/playwright-screenshot-annot-fixture.md`.
//
// Patches `Page.prototype.screenshot` at fixture init time so calls
// carrying a `annot: { mdx | overlays | tags | editable }` nested
// option get a one-line capture pipeline:
//
//   1. (Optional) refresh the MDX `annot:snapshot` block via
//      `captureScreen` from `@ingcreators/annot-product-docs`.
//   2. Take the raw screenshot via the original
//      `Page.prototype.screenshot`.
//   3. Resolve `mdx` overlays + merge with caller-supplied
//      `overlays` into a single `BboxAnnotation[]`.
//   4. Compose the output PNG (editable / flat / tags-only sidecar)
//      via `@ingcreators/annot-annotator` + `@ingcreators/annot-core/xmp-bytes`.
//   5. Write to `path` if given, return `Buffer` for parity with
//      vanilla `page.screenshot`.
//
// Calls WITHOUT `annot` fall through to the original screenshot
// method byte-for-byte — codegen / DevTools Recorder output keeps
// working unedited.
//
// Phase 2 will also patch `Locator.prototype.screenshot` here and
// add coordinate rebasing for sub-region overlays.

import { writeFile } from "node:fs/promises";

import {
  type BboxAnnotation,
  type BboxNumberedBadgeAnnotation,
  createAnnotator,
} from "@ingcreators/annot-annotator";
import { writePngWithTagsOnly } from "@ingcreators/annot-core/xmp-bytes";
import { test as base, captureScreen } from "@ingcreators/annot-product-docs";
import type { Page } from "@playwright/test";

import { resolveMdxAnnotations, svgFromBboxAnnotations } from "../render.js";

const ANNOT_PATCHED = Symbol.for("@ingcreators/annot:screenshot-patched");

/**
 * Compositional options for `page.screenshot({ annot })` /
 * `locator.screenshot({ annot })` (Phase 2). Each field is an
 * independent contribution to the embedded XMP record:
 *
 * - `mdx`     — refresh + resolve MDX `<Overlay>` annotations
 * - `overlays`— inline `BboxAnnotation[]` (the DSL accepted by
 *               `@ingcreators/annot-annotator`)
 * - `tags`    — provenance metadata written verbatim into the XMP
 * - `editable`— bake-vs-preserve toggle (default `true`)
 *
 * `annot: true` / `annot: {}` is treated as a no-op shorthand — the
 * fixture detects no contribution and the screenshot falls through
 * to vanilla Playwright behaviour.
 */
export interface AnnotScreenshotOptions {
  /** Refresh the MDX `annot:snapshot` block and resolve the
   *  `<Screen id>`'s overlays. The MDX file is rewritten in-place
   *  with the current page's aria-snapshot before overlays resolve.
   */
  mdx?: { id: string; path: string };
  /** Caller-supplied annotations — merged with MDX-derived ones if
   *  `mdx` is also set. Same DSL `@ingcreators/annot-annotator`
   *  accepts. */
  overlays?: BboxAnnotation[];
  /** Provenance metadata written verbatim into the PNG's XMP. The
   *  fixture adds no defaults; callers who want `WELL_KNOWN_TAG_KEYS`
   *  (`source` / `screen` / `capturedAt` / `commit`) write them. */
  tags?: Record<string, string>;
  /** When `true` (default): annotations stored as SVG in XMP +
   *  original capture embedded → re-editable in Annot Cloud. When
   *  `false`: annotations baked into the visible pixels, no XMP
   *  layer, no embedded original — flat PNG, no round-trip. */
  editable?: boolean;
}

declare module "@playwright/test" {
  interface PageScreenshotOptions {
    annot?: AnnotScreenshotOptions;
  }
  interface LocatorScreenshotOptions {
    annot?: AnnotScreenshotOptions;
  }
}

/**
 * Idempotent prototype patch — wrap `screenshot` to intercept the
 * `annot` opt while falling through to the original method when
 * absent / empty. Exported for unit tests; production usage flows
 * through the fixture `extend({ page })` body which calls this once
 * per worker on the first page.
 */
export function patchScreenshot(proto: { screenshot: (opts?: unknown) => Promise<Buffer> }): void {
  const protoAny = proto as unknown as Record<symbol, true | undefined>;
  if (protoAny[ANNOT_PATCHED]) return;
  const original = proto.screenshot;
  proto.screenshot = async function (this: Page, opts: unknown = {}) {
    const annot = (opts as { annot?: AnnotScreenshotOptions | true } | undefined)?.annot;
    if (!hasAnnotContribution(annot)) return original.call(this, opts);
    return runAnnotMode.call(
      this,
      original as (opts?: unknown) => Promise<Buffer>,
      opts as PageScreenshotOptionsWithAnnot,
    );
  } as typeof proto.screenshot;
  protoAny[ANNOT_PATCHED] = true;
}

interface PageScreenshotOptionsWithAnnot {
  annot: AnnotScreenshotOptions;
  path?: string;
  [k: string]: unknown;
}

/**
 * Detect whether the `annot` option carries any real contribution.
 * `annot: true` / `annot: {}` / `annot: { editable: ... }` (without
 * any annotation source or tags) all fall through to vanilla
 * Playwright — same byte output as omitting `annot`.
 */
function hasAnnotContribution(
  annot: AnnotScreenshotOptions | true | undefined,
): annot is AnnotScreenshotOptions {
  if (!annot || annot === true) return false;
  return Boolean(annot.mdx || (annot.overlays && annot.overlays.length > 0) || annot.tags);
}

/**
 * Wraps the original `screenshot` call with the annot pipeline.
 * `this` is `Page` (or `Locator` in Phase 2; the discriminator is
 * `typeof this.boundingBox === "function"`).
 */
async function runAnnotMode(
  this: Page,
  original: (opts?: unknown) => Promise<Buffer>,
  opts: PageScreenshotOptionsWithAnnot,
): Promise<Buffer> {
  const { annot, path: outputPath, ...restRaw } = opts;
  // The `annot` field is not a vanilla Playwright option — strip
  // it (and our own `path` since we write after composition).
  const screenshotOpts = restRaw;
  const editable = annot.editable ?? true;

  // 1. Refresh MDX snapshot if `mdx` source is present. This MUST
  //    happen before the raw screenshot so the snapshot's `[box=...]`
  //    markers reflect the current page state.
  if (annot.mdx) {
    await captureScreen(this, {
      id: annot.mdx.id,
      mdxPath: annot.mdx.path,
    });
  }

  // 2. Take the raw screenshot (sans `path` — we write later).
  const rawBytes = await original.call(this, { ...screenshotOpts, path: undefined });
  const rawU8 = toUint8Array(rawBytes);

  // 3. Compose the output bytes.
  const bytes = await composeOutput({
    rawBytes: rawU8,
    annot,
    editable,
  });

  // 4. Write to `path` if given. Mirrors vanilla `page.screenshot`.
  if (outputPath) await writeFile(outputPath, bytes);
  return Buffer.from(bytes);
}

function toUint8Array(b: Buffer | Uint8Array): Uint8Array {
  if (b instanceof Uint8Array && !(b instanceof Buffer)) return b;
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

interface ComposeOutputOptions {
  rawBytes: Uint8Array;
  annot: AnnotScreenshotOptions;
  editable: boolean;
}

/**
 * Per the case matrix in
 * `docs/plans/playwright-screenshot-annot-fixture.md`:
 *
 * - `editable: false` + (overlays|mdx) → flat PNG, overlays baked,
 *   optional iTXt sidecar for tags
 * - (overlays|mdx) → editable PNG (annotations + embedded original
 *   + optional tags). MDX with no resolved overlays still wraps as
 *   editable with an empty annotations layer (Open Question 5).
 * - `tags` only → plain PNG + iTXt sidecar
 * - nothing → raw bytes (caller would have fallen through already
 *   via `hasAnnotContribution`)
 */
async function composeOutput(opts: ComposeOutputOptions): Promise<Uint8Array> {
  const { rawBytes, annot, editable } = opts;
  const dims = readPngDimensions(rawBytes);

  // Resolve annotation sources.
  const annotations: BboxAnnotation[] = [];
  if (annot.mdx) {
    const mdxAnnotations = await resolveMdxAnnotations({
      mdxPath: annot.mdx.path,
      screenId: annot.mdx.id,
      dims,
    });
    annotations.push(...(mdxAnnotations as BboxNumberedBadgeAnnotation[]));
  }
  if (annot.overlays) {
    annotations.push(...annot.overlays);
  }

  const hasAnnotationsRequest = Boolean(annot.mdx || annot.overlays);

  // Path 1: caller wants annotations baked into pixels (no XMP layer).
  if (hasAnnotationsRequest && !editable) {
    const annotationsSvg = svgFromBboxAnnotations(annotations);
    const dataUrl = `data:image/png;base64,${Buffer.from(rawBytes).toString("base64")}`;
    const flat = createAnnotator({ loadSystemFonts: true }).toPng({
      originalDataUrl: dataUrl,
      annotationsSvg,
      width: dims.width,
      height: dims.height,
    });
    return annot.tags ? writePngWithTagsOnly(flat, annot.tags) : flat;
  }

  // Path 2: editable wrap (default behaviour when annotations source
  // is set). Empty annotations are OK — the editor opens it as a
  // session with no overlays on the embedded original.
  if (hasAnnotationsRequest) {
    const annotationsSvg = svgFromBboxAnnotations(annotations);
    const dataUrl = `data:image/png;base64,${Buffer.from(rawBytes).toString("base64")}`;
    return createAnnotator({ loadSystemFonts: true }).toEditablePng({
      originalDataUrl: dataUrl,
      annotationsSvg,
      width: dims.width,
      height: dims.height,
      tags: annot.tags,
    });
  }

  // Path 3: tags-only sidecar. Plain PNG + iTXt chunk, no
  // `<annot:annotations>` element → editor treats as ordinary PNG.
  if (annot.tags) {
    return writePngWithTagsOnly(rawBytes, annot.tags);
  }

  // Unreachable — `hasAnnotContribution` would have short-circuited.
  return rawBytes;
}

/**
 * Parse a PNG's IHDR chunk to extract `width` × `height`. Duplicates
 * the helper from `render.ts` rather than exporting / importing —
 * neither place owns the canonical version (yet), and the shared
 * shape is trivial. A future Phase could lift this into
 * `@ingcreators/annot-core/xmp-bytes` since the read path already
 * walks PNG chunks.
 */
function readPngDimensions(png: Uint8Array): { width: number; height: number } {
  if (png.length < 24) {
    throw new Error("Playwright annot fixture: raw screenshot too short to contain PNG IHDR.");
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return { width, height };
}

/**
 * `test = base.extend({ page })` — drop-in for `@playwright/test`'s
 * `test` plus a one-time patch of `Page.prototype.screenshot` (per
 * worker process) so calls carrying `annot: { ... }` run the annot
 * pipeline above.
 *
 * The base `test` is `@ingcreators/annot-product-docs`'s test which
 * already extends `@ingcreators/annot-playwright` — callers get
 * `page` + `annotator` + `screen` plus the annot-aware screenshot.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    patchScreenshot(
      Object.getPrototypeOf(page) as { screenshot: (opts?: unknown) => Promise<Buffer> },
    );
    await use(page);
  },
});
