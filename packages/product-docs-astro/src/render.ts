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
import {
  type BboxCalloutAnnotation,
  bboxAnnotationsToSvg,
  createAnnotator,
} from "@ingcreators/annot-annotator";
import { type ParsedMdx, parseMdxFile } from "@ingcreators/annot-product-docs";

import { cacheKey, type FileCache } from "./cache.js";

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

  const key = cacheKey({ mdxSource: parsed.source, screenId: options.screenId });
  if (options.cache) {
    const cached = await options.cache.get(key);
    if (cached) {
      return { bytes: cached, fromCache: true, hadBoundingBoxes: true };
    }
  }

  const baseBytes =
    options.basePngBytes ?? (await loadBasePng(parsed, screen.src, dirname(mdxAbs)));
  const bboxes = parseSnapshotBoxes(parsed.commentBlocks.snapshot ?? "");
  const annotations = buildCalloutAnnotations(screen.overlays, bboxes);

  let result: Uint8Array;
  let hadBoundingBoxes: boolean;
  if (annotations.length === 0) {
    result = baseBytes;
    hadBoundingBoxes = false;
  } else {
    const dataUrl = `data:image/png;base64,${Buffer.from(baseBytes).toString("base64")}`;
    const { width, height } = readPngDimensions(baseBytes);
    const annotationsSvg = svgFromCallouts(annotations);
    result = createAnnotator().toPng({
      originalDataUrl: dataUrl,
      annotationsSvg,
      width,
      height,
    });
    hadBoundingBoxes = true;
  }

  if (options.cache) {
    await options.cache.set(key, result);
  }
  return { bytes: result, fromCache: false, hadBoundingBoxes };
}

// ─── snapshot bbox parsing ─────────────────────────────────────

interface BoxedEntry {
  role: string;
  name: string;
  ref: string;
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Parse aria-snapshot YAML for entries that carry both `[ref=…]`
 * and `[box=x,y,w,h]` markers. `box` is the Playwright addition
 * available when `ariaSnapshot({ boxes: true })` was passed.
 *
 * Exposed for unit testing. Returns an empty array if no entries
 * have boxes — the caller falls back to a non-annotated render.
 */
export function parseSnapshotBoxes(yaml: string): BoxedEntry[] {
  const out: BoxedEntry[] = [];
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const head = line.match(/^\s*-\s+([a-z]+)(?:\s+"([^"]*?)")?/);
    if (!head) continue;
    const role = head[1] ?? "";
    const name = head[2] ?? "";
    const ref = line.match(/\[ref=(e\d+)\]/)?.[1];
    const box = line.match(
      /\[box=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]/,
    );
    if (!ref || !box) continue;
    out.push({
      role,
      name,
      ref,
      box: {
        x: Number.parseFloat(box[1]!),
        y: Number.parseFloat(box[2]!),
        width: Number.parseFloat(box[3]!),
        height: Number.parseFloat(box[4]!),
      },
    });
  }
  return out;
}

function buildCalloutAnnotations(
  overlays: ParsedMdx["screens"][number]["overlays"],
  boxed: BoxedEntry[],
): BboxCalloutAnnotation[] {
  const annotations: BboxCalloutAnnotation[] = [];
  let auto = 1;
  for (const overlay of overlays) {
    const entry = boxed.find((b) => b.role === overlay.match.role && b.name === overlay.match.name);
    if (!entry) continue;
    const num = overlay.number ?? auto++;
    annotations.push({
      type: "callout",
      at: { x: entry.box.x + entry.box.width / 2, y: entry.box.y - 16 },
      targetBbox: entry.box,
      content: String(num),
      intent:
        overlay.intent === "action" ? "warning" : overlay.intent === "required" ? "error" : "info",
    });
  }
  return annotations;
}

function svgFromCallouts(callouts: BboxCalloutAnnotation[]): string {
  // `bboxAnnotationsToSvg` returns a multi-root fragment
  // (`<rect/><defs/><line/><text/>`); the annotator's sanitiser
  // expects a single-root SVG document and silently drops the
  // siblings otherwise. Wrap in an `<svg>` so all primitives
  // survive into the composited output.
  const fragment = bboxAnnotationsToSvg(callouts);
  return `<svg xmlns="http://www.w3.org/2000/svg">${fragment}</svg>`;
}

// ─── helpers ───────────────────────────────────────────────────

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
