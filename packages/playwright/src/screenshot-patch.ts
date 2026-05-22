// `Page.prototype.screenshot` / `Locator.prototype.screenshot`
// prototype patch implementing the `annot: { … }` option.
//
// Phase 1 of `docs/plans/playwright-screenshot-fixture-relayer.md`.
// Moved here from `packages/product-docs-astro/src/playwright/fixture.ts`
// — annot-playwright owns the generic patch + the resolver registry;
// MDX-aware behaviour layers in via a resolver registered by
// `@ingcreators/annot-product-docs` (Phase 2).
//
// Calls WITHOUT `annot` (or with `annot: true` / `annot: {}`) fall
// through to the original screenshot method byte-for-byte — codegen
// / DevTools Recorder output keeps working unedited.

import { writeFile } from "node:fs/promises";

import {
  type BboxAnnotation,
  bboxAnnotationsToSvg,
  createAnnotator,
} from "@ingcreators/annot-annotator";
import { writePngWithTagsOnly } from "@ingcreators/annot-core/xmp-bytes";
import type { Locator, Page } from "@playwright/test";
import { test as base } from "@playwright/test";

import { type Clip, describeAnnotation, rebaseAnnotations } from "./rebase.js";
import {
  ANNOT_PATCHED,
  type AnnotScreenshotOptions,
  type AnnotSourceContribution,
  annotSourceResolvers,
} from "./screenshot-hooks.js";

/** Fields on `AnnotScreenshotOptions` that the generic patch knows
 *  about by name. Anything else (e.g. `mdx`) is an unknown field
 *  that a resolver might claim. */
const KNOWN_ANNOT_FIELDS = new Set<string>(["overlays", "tags", "editable"]);

/**
 * Idempotent prototype patch — wrap `screenshot` to intercept the
 * `annot` opt while falling through to the original method when
 * absent / empty. Exported for unit tests; production usage flows
 * through the fixture `extend({ page })` body which calls this once
 * per worker on the `Page` AND `Locator` prototypes.
 */
export function patchScreenshot(proto: { screenshot: (opts?: unknown) => Promise<Buffer> }): void {
  const protoAny = proto as unknown as Record<symbol, true | undefined>;
  if (protoAny[ANNOT_PATCHED]) return;
  const original = proto.screenshot;
  proto.screenshot = async function (this: Page | Locator, opts: unknown = {}) {
    const annot = (opts as { annot?: AnnotScreenshotOptions | true } | undefined)?.annot;
    if (!hasAnnotShape(annot)) {
      return original.call(this, opts);
    }
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
 * Cheap pre-check: should we enter the annot pipeline at all?
 *
 * - Known truthy fields (`overlays` with entries, `tags`) → yes.
 * - Unknown fields (e.g. `mdx`, future `figma`) → yes, defer the
 *   actual claim decision to the registry probe in `runAnnotMode`.
 *   Without this, an `annot: { mdx }` call would fall through to
 *   vanilla on platforms where annot-playwright is imported but
 *   the MDX resolver isn't registered yet — which is correct, but
 *   we want the registry to make the call, not the type system.
 * - `annot: true` / `annot: {}` / `annot: { editable }` (no other
 *   field) → no, fall through.
 */
function hasAnnotShape(
  annot: AnnotScreenshotOptions | true | undefined,
): annot is AnnotScreenshotOptions {
  if (!annot || annot === true) return false;
  if (annot.overlays && annot.overlays.length > 0) return true;
  if (annot.tags) return true;
  for (const key of Object.keys(annot)) {
    if (!KNOWN_ANNOT_FIELDS.has(key)) return true;
  }
  return false;
}

/**
 * Discriminator for the patched `this`. `Locator` has
 * `boundingBox()`; `Page` does not. We use this both to fetch the
 * implicit clip for locator screenshots and to resolve `this` back
 * to a `Page` (via `Locator.page()`) for resolvers that need it.
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

  // 1. Walk the resolver registry. Each resolver returns either
  //    `null` (it doesn't claim this `annot`) or an
  //    AnnotSourceContribution with optional `prepare()` +
  //    required `resolveAnnotations()`.
  const ctx = { annot, page: pageFor(this), receiver: this };
  const probed = await Promise.all(annotSourceResolvers.map((resolver) => resolver(ctx)));
  const contributions = probed.filter((c): c is AnnotSourceContribution => c !== null);

  // 2. If nothing claimed the call AND there are no known
  //    contributions (overlays / tags), fall back to vanilla.
  //    This covers the case where a caller passes an
  //    `annot: { mdx }`-shaped opt but the MDX resolver hasn't
  //    been registered (e.g. Phase 1 standalone use).
  const hasKnownSource = (annot.overlays?.length ?? 0) > 0 || Boolean(annot.tags);
  if (contributions.length === 0 && !hasKnownSource) {
    return original.call(this, opts);
  }

  // 3. Run resolver `prepare()` hooks serially in registration
  //    order. This is where MDX-aware resolvers rewrite their
  //    `annot:snapshot` block against the live DOM.
  for (const c of contributions) {
    if (c.prepare) await c.prepare();
  }

  // 4. Resolve the implicit clip for locator screenshots (or
  //    honour an explicit `clip` on a page screenshot). Both flow
  //    through the same rebase pipeline downstream.
  const clip = await resolveClip(this, opts.clip);

  // 5. Take the raw screenshot (sans `path` — we write later).
  //    For locators the original method already returns the
  //    cropped bytes; for pages with `clip`, ditto. The bytes'
  //    IHDR width / height match the clip's, which is what
  //    `composeOutput` reads.
  const rawBytes = await original.call(this, { ...screenshotOpts, path: undefined });
  const rawU8 = toUint8Array(rawBytes);

  // 6. Compose the output bytes.
  const bytes = await composeOutput({
    rawBytes: rawU8,
    annot,
    editable,
    clip,
    contributions,
  });

  // 7. Write to `path` if given. Mirrors vanilla `page.screenshot`.
  if (outputPath) await writeFile(outputPath, bytes);
  return Buffer.from(bytes);
}

/**
 * Determine the clip rectangle that overlay coordinates need to be
 * rebased against.
 *
 * - `Locator.screenshot({ annot })`: use `locator.boundingBox()`.
 *   Throws with a friendly diagnostic if the locator isn't
 *   visible.
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
  /** Resolver contributions whose `resolveAnnotations()` is called
   *  here with the page-space dimensions. Each contribution's
   *  annotations are merged into the output. */
  contributions: AnnotSourceContribution[];
}

/**
 * Per the case matrix in
 * `docs/plans/_done/playwright-screenshot-annot-fixture.md`:
 *
 * - `editable: false` + (overlays | resolver-source) → flat PNG,
 *   overlays baked, optional iTXt sidecar for tags.
 * - (overlays | resolver-source) → editable PNG (annotations +
 *   embedded original + optional tags). Resolver with no resolved
 *   overlays still wraps as editable with an empty annotations
 *   layer (Open Question 5 of the parent plan).
 * - `tags` only → plain PNG + iTXt sidecar.
 * - nothing → raw bytes (caller would have fallen through already
 *   via `hasAnnotShape` / the empty-contributions check above).
 */
async function composeOutput(opts: ComposeOutputOptions): Promise<Uint8Array> {
  const { rawBytes, annot, editable, clip, contributions } = opts;
  const dims = readPngDimensions(rawBytes);

  // Resolve annotation sources against PAGE coords (always —
  // resolver-returned bboxes are page-space). Rebase happens after.
  const sourceAnnotations: BboxAnnotation[] = [];
  // pageDims = full page dimensions when clipping is in effect, so
  // resolvers can place against the page edge rather than the
  // clipped corner. Rebasing handles clip translation downstream.
  const pageDims = clip ? { width: clip.x + clip.width, height: clip.y + clip.height } : dims;
  for (const c of contributions) {
    const resolved = await c.resolveAnnotations(pageDims);
    sourceAnnotations.push(...resolved);
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

  const hasAnnotationsRequest = contributions.length > 0 || Boolean(annot.overlays);

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

  // Path 2: editable wrap (default behaviour when an annotation
  // source is set). Empty annotations are OK — the editor opens
  // it as a session with no overlays on the embedded original.
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

  // Unreachable — `hasAnnotShape` + the early return inside
  // `runAnnotMode` would have short-circuited.
  return rawBytes;
}

/**
 * Wrap a list of `BboxAnnotation`s into the `<svg>` fragment shape
 * `createAnnotator().toPng()` / `.toEditablePng()` accepts. Mirrors
 * the helper in `packages/product-docs-astro/src/render.ts`
 * (Phase 2 of the relayer plan moves it into annot-product-docs);
 * we duplicate the trivial wrapper here so annot-playwright doesn't
 * depend on annot-product-docs / annot-product-docs-astro.
 */
function svgFromBboxAnnotations(annotations: BboxAnnotation[]): string {
  // `bboxAnnotationsToSvg` returns a multi-root fragment (`<rect/>
  // <circle/><text/>` etc.); the annotator's sanitiser expects a
  // single-root SVG document and silently drops the siblings
  // otherwise. Wrap in an `<svg>` so all primitives survive into
  // the composited output. Empty input returns the empty wrapper
  // so the editor opens the file with no annotations layer rather
  // than throwing.
  if (annotations.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  }
  const fragment = bboxAnnotationsToSvg(annotations);
  return `<svg xmlns="http://www.w3.org/2000/svg">${fragment}</svg>`;
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
  console.warn(msg);
  tryPlaywrightAnnotation(msg, dropped);
}

function tryPlaywrightAnnotation(msg: string, dropped: BboxAnnotation[]): void {
  type TestInfoLike = {
    annotations: Array<{ type: string; description?: string }>;
  };
  try {
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
 * Parse a PNG's IHDR chunk to extract `width` × `height`.
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
