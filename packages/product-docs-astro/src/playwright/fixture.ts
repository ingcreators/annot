// Playwright `page.screenshot({ annot: { … } })` /
// `locator.screenshot({ annot: { … } })` fixture.
//
// Phases 1–2 of `docs/plans/playwright-screenshot-annot-fixture.md`.
//
// Patches `Page.prototype.screenshot` AND `Locator.prototype.screenshot`
// at fixture init time so calls carrying a `annot: { mdx | overlays
// | tags | editable }` nested option get a one-line capture pipeline:
//
//   1. (Optional) refresh the MDX `annot:snapshot` block via
//      `captureScreen` from `@ingcreators/annot-product-docs`.
//   2. Take the raw screenshot via the original `screenshot` method.
//   3. Resolve `mdx` overlays + merge with caller-supplied
//      `overlays` into a single `BboxAnnotation[]`.
//   4. For locator screenshots (or `page.screenshot({ clip })`),
//      rebase + filter the annotations onto clip-space coords.
//   5. Compose the output PNG (editable / flat / tags-only sidecar)
//      via `@ingcreators/annot-annotator` + `@ingcreators/annot-core/xmp-bytes`.
//   6. Write to `path` if given, return `Buffer` for parity with
//      vanilla `screenshot`.
//
// Calls WITHOUT `annot` fall through to the original screenshot
// method byte-for-byte — codegen / DevTools Recorder output keeps
// working unedited.

import { writeFile } from "node:fs/promises";

import {
  type BboxAnnotation,
  type BboxNumberedBadgeAnnotation,
  createAnnotator,
} from "@ingcreators/annot-annotator";
import { writePngWithTagsOnly } from "@ingcreators/annot-core/xmp-bytes";
// Side-effect import: pulls annot-playwright's module-augmentation
// of `@playwright/test`'s screenshot options into scope. With the
// Phase 1 relayer landed, annot-playwright owns the canonical
// `annot?: AnnotScreenshotOptions` declaration on
// `PageScreenshotOptions` / `LocatorScreenshotOptions` and exports
// the base interface that this file's `AnnotScreenshotOptions`
// extends.
import type { AnnotScreenshotOptions as BaseAnnotOptions } from "@ingcreators/annot-playwright";
import { test as base, syncProductDocs } from "@ingcreators/annot-product-docs";
import type { Locator, Page } from "@playwright/test";

import { resolveMdxAnnotations, svgFromBboxAnnotations } from "../render.js";
import { type Clip, describeAnnotation, rebaseAnnotations } from "./rebase.js";

const ANNOT_PATCHED = Symbol.for("@ingcreators/annot:screenshot-patched");

/**
 * Compositional options for `page.screenshot({ annot })` /
 * `locator.screenshot({ annot })`. Each field is an independent
 * contribution to the embedded XMP record:
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
 *
 * Phase 1 of `docs/plans/playwright-screenshot-fixture-relayer.md`:
 * `overlays` / `tags` / `editable` now live on annot-playwright's
 * exported `AnnotScreenshotOptions`; this file extends that base
 * with the MDX-aware `mdx` field via module augmentation so the
 * `@playwright/test` option type — augmented once in
 * annot-playwright — picks the field up for callers using this
 * fixture's `test`.
 */
declare module "@ingcreators/annot-playwright" {
  interface AnnotScreenshotOptions {
    /** Refresh the MDX `annot:snapshot` block and resolve the
     *  `<Screen id>`'s overlays. The MDX file is rewritten in-place
     *  with the current page's aria-snapshot before overlays resolve.
     */
    mdx?: { id: string; path: string };
  }
}

/** Back-compat re-export of the (now augmented) interface from
 *  annot-playwright. Existing callers that imported
 *  `AnnotScreenshotOptions` from this package keep working. */
export type AnnotScreenshotOptions = BaseAnnotOptions;

/**
 * Idempotent prototype patch — wrap `screenshot` to intercept the
 * `annot` opt while falling through to the original method when
 * absent / empty. Exported for unit tests; production usage flows
 * through the fixture `extend({ page })` body which calls this once
 * per worker on the first page (and once for the locator prototype).
 */
export function patchScreenshot(proto: { screenshot: (opts?: unknown) => Promise<Buffer> }): void {
  const protoAny = proto as unknown as Record<symbol, true | undefined>;
  if (protoAny[ANNOT_PATCHED]) return;
  const original = proto.screenshot;
  proto.screenshot = async function (this: Page | Locator, opts: unknown = {}) {
    const annot = (opts as { annot?: AnnotScreenshotOptions | true } | undefined)?.annot;
    if (!hasAnnotContribution(annot)) return original.call(this, opts);
    return runAnnotMode.call(
      this,
      original as (opts?: unknown) => Promise<Buffer>,
      opts as ScreenshotOptionsWithAnnot,
    );
  } as typeof proto.screenshot;
  protoAny[ANNOT_PATCHED] = true;
}

interface ScreenshotOptionsWithAnnot {
  annot: AnnotScreenshotOptions;
  path?: string;
  clip?: Clip;
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
 * Discriminator for the patched `this`. `Locator` has
 * `boundingBox()`; `Page` does not. We use this both to fetch the
 * implicit clip for locator screenshots and to resolve `this` back
 * to a `Page` (via `Locator.page()`) for `captureScreen`'s MDX
 * snapshot refresh.
 */
function isLocator(self: Page | Locator): self is Locator {
  return typeof (self as Locator).boundingBox === "function";
}

function pageFor(self: Page | Locator): Page {
  return isLocator(self) ? self.page() : self;
}

/**
 * Wraps the original `screenshot` call with the annot pipeline.
 * `this` is `Page` or `Locator` — handled uniformly modulo the
 * implicit clip for locator screenshots.
 */
async function runAnnotMode(
  this: Page | Locator,
  original: (opts?: unknown) => Promise<Buffer>,
  opts: ScreenshotOptionsWithAnnot,
): Promise<Buffer> {
  const { annot, path: outputPath, ...restRaw } = opts;
  const screenshotOpts = restRaw;
  const editable = annot.editable ?? true;

  // 1. Refresh MDX snapshot if `mdx` source is present. The refresh
  //    targets the page-level aria-snapshot regardless of whether
  //    we're shooting a locator — overlay bboxes are always
  //    page-space; rebasing happens after.
  if (annot.mdx) {
    await syncProductDocs(pageFor(this), {
      id: annot.mdx.id,
      mdxPath: annot.mdx.path,
    });
  }

  // 2. Resolve the implicit clip for locator screenshots (or honour
  //    an explicit `clip` on a page screenshot). Both flow through
  //    the same rebase pipeline downstream.
  const clip = await resolveClip(this, opts.clip);

  // 3. Take the raw screenshot (sans `path` — we write later). For
  //    locators the original method already returns the cropped
  //    bytes; for pages with `clip`, ditto. The bytes' IHDR width /
  //    height match the clip's, which is what `composeOutput` reads.
  const rawBytes = await original.call(this, { ...screenshotOpts, path: undefined });
  const rawU8 = toUint8Array(rawBytes);

  // 4. Compose the output bytes.
  const bytes = await composeOutput({
    rawBytes: rawU8,
    annot,
    editable,
    clip,
  });

  // 5. Write to `path` if given. Mirrors vanilla `page.screenshot`.
  if (outputPath) await writeFile(outputPath, bytes);
  return Buffer.from(bytes);
}

/**
 * Determine the clip rectangle that overlay coordinates need to be
 * rebased against.
 *
 * - `Locator.screenshot({ annot })`: use `locator.boundingBox()`
 *   (Open Question 3 default — auto). Throws with a friendly
 *   diagnostic if the locator isn't visible.
 * - `Page.screenshot({ clip, annot })`: honour the user's explicit
 *   clip — page-space `clip` already matches the rebase semantics.
 * - `Page.screenshot({ annot })` (no clip): returns `null`, no
 *   rebase happens, annotations stay in page-space.
 */
async function resolveClip(
  self: Page | Locator,
  explicitClip: Clip | undefined,
): Promise<Clip | null> {
  if (isLocator(self)) {
    const bbox = await self.boundingBox();
    if (!bbox) {
      throw new Error(
        "locator.screenshot({ annot }): locator has no bounding box (probably not visible). " +
          "Re-test with a stable selector / waitFor().",
      );
    }
    return bbox;
  }
  return explicitClip ?? null;
}

function toUint8Array(b: Buffer | Uint8Array): Uint8Array {
  if (b instanceof Uint8Array && !(b instanceof Buffer)) return b;
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

interface ComposeOutputOptions {
  rawBytes: Uint8Array;
  annot: AnnotScreenshotOptions;
  editable: boolean;
  /** When set, annotations are rebased + filtered against this clip
   *  before composition. The rawBytes already match the clipped
   *  dimensions (Playwright handles the visible-pixel cropping). */
  clip: Clip | null;
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
  const { rawBytes, annot, editable, clip } = opts;
  const dims = readPngDimensions(rawBytes);

  // Resolve annotation sources against PAGE coords (always — the
  // MDX snapshot's bboxes are page-space). Rebase happens after.
  const sourceAnnotations: BboxAnnotation[] = [];
  if (annot.mdx) {
    // Use the full page dims (not the clip dims) for MDX placement
    // calculations; rebasing handles clip translation downstream.
    const pageDims = clip ? { width: clip.x + clip.width, height: clip.y + clip.height } : dims;
    const mdxAnnotations = await resolveMdxAnnotations({
      mdxPath: annot.mdx.path,
      screenId: annot.mdx.id,
      dims: pageDims,
    });
    sourceAnnotations.push(...(mdxAnnotations as BboxNumberedBadgeAnnotation[]));
  }
  if (annot.overlays) {
    sourceAnnotations.push(...annot.overlays);
  }

  // Rebase + filter against the clip when present. Otherwise the
  // annotations are already in image space (matching dims).
  let annotations: BboxAnnotation[];
  if (clip) {
    const { kept, dropped } = rebaseAnnotations(sourceAnnotations, clip);
    annotations = kept;
    if (dropped.length > 0) reportDroppedOverlays(dropped);
  } else {
    annotations = sourceAnnotations;
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
 * Surface dropped overlays to the running Playwright `test.info()`
 * as a warning annotation (when the test runtime is available),
 * and always to stderr as a fallback. Importing `test.info()`
 * lazily so non-Playwright test contexts (vitest unit tests) don't
 * crash.
 */
function reportDroppedOverlays(dropped: BboxAnnotation[]): void {
  const labels = dropped.map(describeAnnotation).join(", ");
  const msg = `annot fixture: dropped ${dropped.length} overlay(s) outside the screenshot clip — ${labels}`;
  // Best-effort: emit to stderr for visibility regardless of runner.
  console.warn(msg);
  // Surface via Playwright's test.info() annotations when running
  // inside a Playwright test. Loaded lazily and guarded so vitest
  // unit tests (and other non-Playwright runners) don't fail.
  tryPlaywrightAnnotation(msg, dropped);
}

function tryPlaywrightAnnotation(msg: string, dropped: BboxAnnotation[]): void {
  type TestInfoLike = {
    annotations: Array<{ type: string; description?: string }>;
  };
  // Resolve `test.info()` indirectly — direct top-level import of
  // `@playwright/test`'s `test` is safe, but `test.info()` throws
  // when called outside a Playwright test worker. Try/catch around
  // it keeps vitest unit tests clean.
  try {
    // The base test is available via the workspace dep; reach for
    // it without forcing a static import that could complicate
    // tree-shaking.
    const info = (base as unknown as { info?: () => TestInfoLike }).info?.();
    if (!info?.annotations) return;
    info.annotations.push({
      type: "warning",
      description: `${msg} (${dropped.length} dropped)`,
    });
  } catch {
    // Not running under Playwright — silent.
  }
}

/**
 * Parse a PNG's IHDR chunk to extract `width` × `height`. Duplicates
 * the helper from `render.ts` rather than exporting / importing —
 * neither place owns the canonical version (yet), and the shared
 * shape is trivial.
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
 * `test` plus a one-time patch of `Page.prototype.screenshot` AND
 * `Locator.prototype.screenshot` (per worker process) so calls
 * carrying `annot: { ... }` run the annot pipeline above.
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
    // Patch the Locator prototype too. `page.locator("html")` returns
    // a real Locator regardless of whether `html` matches; we just
    // need it for the prototype reference.
    patchScreenshot(
      Object.getPrototypeOf(page.locator("html")) as {
        screenshot: (opts?: unknown) => Promise<Buffer>;
      },
    );
    await use(page);
  },
});
