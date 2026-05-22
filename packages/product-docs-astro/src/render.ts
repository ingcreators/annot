// `<Screen>` → annotated PNG renderer.
//
// Phase 2 PR 2 of `docs/plans/living-product-docs.md`. Walks an
// MDX file's `<Screen id>` block, loads the referenced base PNG
// from disk, and composes it with an SVG overlay derived from
// the `<Overlay>` blocks inside the same `<Screen>`.
//
// The overlay positions come from the stored `annot:snapshot`
// comment block: when the fixture's
// `ariaSnapshot({ boxes: true, mode: "ai" })` output is
// available (each entry has a `[box=x,y,w,h]` marker), we have
// real per-element coordinates and can stamp a numbered callout
// at each `<Overlay match>`. Without bbox data the function
// falls back to returning the base PNG verbatim — useful so
// the docs site still builds while the author hasn't run the
// Playwright tour yet.
//
// All inputs are pure data; no DOM, no Playwright. The annotator
// itself (`@ingcreators/annot-annotator`) is the only browser-
// adjacent dep and it ships as a Tier A Node-only package.

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { createAnnotator } from "@ingcreators/annot-annotator";
import { readElementTreePng } from "@ingcreators/annot-core";
import {
  buildBadgeAnnotations,
  elementTreeToBoxedEntries,
  emptyAnnotationsSvg,
  type ParsedMdx,
  parseMdxFile,
  parseSnapshotBoxes,
  svgFromBadges,
} from "@ingcreators/annot-product-docs";

import { cacheKey, type FileCache } from "./cache.js";

// Re-export the moved helpers so callers that previously imported
// them from `@ingcreators/annot-product-docs-astro` keep working.
// Phase 4 of `docs/plans/playwright-screenshot-fixture-relayer.md`
// moved their canonical home to `@ingcreators/annot-product-docs`;
// these re-exports are removed in 0.5.0 alongside the deprecated
// `/playwright` subpath.
export { resolveMdxAnnotations, svgFromBboxAnnotations } from "@ingcreators/annot-product-docs";

export interface RenderAnnotatedScreenOptions {
  /** Path to the `.mdx` file (absolute or relative to cwd). */
  mdxPath: string;
  /** Must match a `<Screen id="...">` inside the MDX. */
  screenId: string;
  /** Optional cache. When supplied, identical inputs short-circuit to a cached buffer. */
  cache?: FileCache;
  /** Override the cwd used to resolve relative `mdxPath`. */
  cwd?: string;
  /**
   * Override the base PNG that `<Screen src>` would otherwise
   * point at. Useful when the on-disk PNG and the served URL
   * diverge — e.g. an Astro site that serves PNGs from
   * `public/` while the MDX `<Screen src>` carries the
   * absolute browser URL. The caller hands in the bytes
   * directly and `loadBasePng` is skipped.
   */
  basePngBytes?: Uint8Array;
  /**
   * Emit a re-editable PNG instead of a flat raster. When set,
   * the visible pixels match the default rasterised output but
   * the file additionally carries the original (un-annotated)
   * base image + the annotations SVG in the PNG's XMP metadata
   * + custom `svGo` chunk, so re-opening the file in Annot Cloud
   * / the editor / VSCode hosts restores the annotations as
   * selectable / movable objects.
   *
   * Pass `true` for the defaults, or an object to set the optional
   * `tags` field on the embedded XMP (e.g. `source` / `screen` /
   * `capturedAt` provenance metadata — see
   * `@ingcreators/annot-annotator`'s `EditableInput`).
   *
   * When no overlay bboxes resolve (the snapshot block has no
   * `[box=…]` markers yet), the base PNG is wrapped as an editable
   * PNG with an empty annotations layer — re-opening still works,
   * the editor just shows the un-annotated capture.
   */
  editable?: boolean | { tags?: Record<string, string> };
}

export interface RenderResult {
  /** Annotated PNG bytes. */
  bytes: Uint8Array;
  /** Whether the result came from cache. Useful for logging. */
  fromCache: boolean;
  /**
   * `false` when the source had no bbox markers and we
   * returned the base PNG verbatim. The Image Service surfaces
   * this so an Astro plugin can warn the author to run the
   * Playwright tour.
   */
  hadBoundingBoxes: boolean;
}

/**
 * Top-level renderer used by both the Astro Image Service and
 * vitest test cases. Steps:
 *
 *   1. Parse the MDX via `parseMdxFile`.
 *   2. Find the `<Screen id>` matching `screenId`. Throw with a
 *      friendly diagnostic if missing.
 *   3. Compute the cache key from the MDX source + `screenId`.
 *      On a cache hit, return the bytes immediately.
 *   4. Load the base PNG referenced by `<Screen src>`.
 *   5. Parse the stored `annot:snapshot` block for bbox markers.
 *      If absent, return base PNG verbatim.
 *   6. Build a typed `BboxCalloutAnnotation[]` from the overlays
 *      + bbox data, hand it to `createAnnotator().toPng(...)`,
 *      and return the result.
 */
export async function renderAnnotatedScreen(
  options: RenderAnnotatedScreenOptions,
): Promise<RenderResult> {
  const cwd = options.cwd ?? process.cwd();
  const mdxAbs = isAbsolute(options.mdxPath) ? options.mdxPath : resolve(cwd, options.mdxPath);

  const parsed = await parseMdxFile(mdxAbs);
  if (!parsed) {
    throw new Error(
      `renderAnnotatedScreen: ${options.mdxPath} has no \`annot:\` frontmatter — cannot render.`,
    );
  }
  const screen = parsed.screens.find((s) => s.id === options.screenId);
  if (!screen) {
    throw new Error(
      `renderAnnotatedScreen: ${options.mdxPath} has no <Screen id="${options.screenId}"> block.`,
    );
  }

  const editable = normaliseEditable(options.editable);
  // Cache key includes the editable flag so flat + editable variants of
  // the same screen don't collide. Tag values are deliberately NOT in
  // the cache key — they only affect XMP metadata, not pixel output,
  // and including timestamps / commit SHAs would defeat caching.
  const key = cacheKey({
    mdxSource: parsed.source,
    screenId: options.screenId,
    editable: editable !== null,
  });
  if (options.cache) {
    const cached = await options.cache.get(key);
    if (cached) {
      return { bytes: cached, fromCache: true, hadBoundingBoxes: true };
    }
  }

  const baseBytes =
    options.basePngBytes ?? (await loadBasePng(parsed, screen.src, dirname(mdxAbs)));
  const dims = readPngDimensions(baseBytes);
  // Prefer the canonical `annot:elementTree` PNG XMP chunk (Phase
  // 1d) when present — that's where post-migration PNGs carry
  // their boxed elements. Fall back to the legacy
  // `annot:snapshot` MDX comment block for pre-migration files.
  // Phase 1i deletes the comment-block path once every consumer
  // has migrated.
  let bboxes: ReturnType<typeof parseSnapshotBoxes>;
  let bboxSource: "elementTreeXmp" | "legacySnapshotBlock";
  const elementTree = safeReadElementTree(baseBytes);
  if (elementTree) {
    bboxes = elementTreeToBoxedEntries(elementTree);
    bboxSource = "elementTreeXmp";
  } else {
    bboxes = parseSnapshotBoxes(parsed.commentBlocks.snapshot ?? "");
    bboxSource = "legacySnapshotBlock";
  }
  // `bboxSource` is reserved for future telemetry; suppress the
  // unused-var diagnostic without changing the variable shape.
  void bboxSource;
  const annotations = buildBadgeAnnotations(screen.overlays, bboxes, dims);

  let result: Uint8Array;
  let hadBoundingBoxes: boolean;
  if (annotations.length === 0) {
    hadBoundingBoxes = false;
    if (editable !== null) {
      // No overlays to bake, but the caller still wants an editable
      // file — wrap the base PNG with an empty annotations layer so
      // re-opening in Annot loads the un-annotated capture.
      const dataUrl = `data:image/png;base64,${Buffer.from(baseBytes).toString("base64")}`;
      result = createAnnotator({ loadSystemFonts: true }).toEditablePng({
        originalDataUrl: dataUrl,
        annotationsSvg: emptyAnnotationsSvg(),
        width: dims.width,
        height: dims.height,
        tags: editable.tags,
      });
    } else {
      result = baseBytes;
    }
  } else {
    const dataUrl = `data:image/png;base64,${Buffer.from(baseBytes).toString("base64")}`;
    const annotationsSvg = svgFromBadges(annotations);
    // The badge primitive emits `<text>` for each numbered label.
    // `@ingcreators/annot-annotator` defaults `loadSystemFonts:
    // false` for CI determinism — fine for the bare-rect /
    // arrow primitives but means the badge numbers render as
    // invisible glyphs. The Image Service is a text-bearing
    // path by construction, so we opt-in here. Callers that
    // need a stricter font set can pre-render with their own
    // `createAnnotator` invocation and pass `basePngBytes`
    // for the unannotated fall-through.
    const annotator = createAnnotator({ loadSystemFonts: true });
    const input = {
      originalDataUrl: dataUrl,
      annotationsSvg,
      width: dims.width,
      height: dims.height,
    };
    result =
      editable !== null
        ? annotator.toEditablePng({ ...input, tags: editable.tags })
        : annotator.toPng(input);
    hadBoundingBoxes = true;
  }

  if (options.cache) {
    await options.cache.set(key, result);
  }
  return { bytes: result, fromCache: false, hadBoundingBoxes };
}

/**
 * Normalise the `editable` option onto a single nullable record. `null`
 * = flat raster (default). Object = editable PNG, with the optional
 * `tags` field passed verbatim to `Annotator.toEditablePng`.
 */
function normaliseEditable(
  v: RenderAnnotatedScreenOptions["editable"],
): { tags?: Record<string, string> } | null {
  if (!v) return null;
  if (v === true) return {};
  return v;
}

// ─── helpers ───────────────────────────────────────────────────

/**
 * Tolerant wrapper around `readElementTreePng`: returns null when
 * the PNG carries no chunk, when the chunk is malformed, or when
 * the schema version is unrecognised. The Astro Image Service
 * MUST keep producing a result regardless of XMP state — failing
 * the build for a stale chunk would be hostile to migration.
 */
function safeReadElementTree(bytes: Uint8Array): ReturnType<typeof readElementTreePng> | null {
  try {
    return readElementTreePng(bytes);
  } catch {
    return null;
  }
}

async function loadBasePng(
  _parsed: ParsedMdx,
  src: string | undefined,
  mdxDir: string,
): Promise<Uint8Array> {
  if (!src) {
    throw new Error(
      "renderAnnotatedScreen: <Screen src=...> is required — cannot render without a base image.",
    );
  }
  const abs = isAbsolute(src) ? src : resolve(mdxDir, src);
  const buf = await readFile(abs);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Parse a PNG's IHDR chunk to extract `width` × `height`. Same
 * approach as `annot-playwright/src/fixture.ts:readPngDimensions`
 * — duplicated here so this package stays one annotator hop deep
 * (no `annot-playwright` dep).
 */
function readPngDimensions(png: Uint8Array): { width: number; height: number } {
  if (png.length < 24) {
    throw new Error("renderAnnotatedScreen: base PNG too short to contain IHDR.");
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return { width, height };
}
