// MDX → `BboxNumberedBadgeAnnotation[]` resolver + the
// single-root SVG wrappers the headless annotator expects.
//
// Phase 2 of `docs/plans/playwright-screenshot-fixture-relayer.md`.
// Originally lived in `packages/product-docs-astro/src/render.ts`;
// moved here so the Playwright screenshot hook (Tier C, MDX-aware)
// and the Astro Image Service (Tier B-render) both consume one
// canonical resolver. All inputs are pure data — no DOM, no
// Playwright runtime.

import { isAbsolute, resolve } from "node:path";

import {
  type BboxAnnotation,
  type BboxNumberedBadgeAnnotation,
  bboxAnnotationsToSvg,
} from "@ingcreators/annot-annotator";

import { parseMdxFile } from "./mdx.js";
import type { OverlaySpec } from "./types.js";

/** A parsed entry of an aria-snapshot YAML line carrying both a
 *  `[ref=…]` marker and a `[box=x,y,w,h]` marker. */
export interface BoxedEntry {
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
 * have boxes — callers fall back to a non-annotated render.
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
        x: Number.parseFloat(box[1] ?? "0"),
        y: Number.parseFloat(box[2] ?? "0"),
        width: Number.parseFloat(box[3] ?? "0"),
        height: Number.parseFloat(box[4] ?? "0"),
      },
    });
  }
  return out;
}

/**
 * Resolve a screen's `<Overlay match>` blocks against the parsed
 * `BoxedEntry[]` from its snapshot YAML, emitting typed
 * `BboxNumberedBadgeAnnotation`s ready for
 * `createAnnotator().toPng()` / `.toEditablePng()`.
 *
 * Overlays with no matching boxed entry are skipped silently —
 * the drift detector (`detectDrift`) surfaces those upstream.
 */
export function buildBadgeAnnotations(
  overlays: readonly OverlaySpec[],
  boxed: readonly BoxedEntry[],
  dims: { width: number; height: number },
): BboxNumberedBadgeAnnotation[] {
  const annotations: BboxNumberedBadgeAnnotation[] = [];
  let auto = 1;
  for (const overlay of overlays) {
    const entry = boxed.find((b) => b.role === overlay.match.role && b.name === overlay.match.name);
    if (!entry) continue;
    const num = overlay.number ?? auto++;
    annotations.push({
      type: "numberedBadge",
      bbox: entry.box,
      number: num,
      placement: "auto",
      imageWidth: dims.width,
      imageHeight: dims.height,
      intent:
        overlay.intent === "action" ? "warning" : overlay.intent === "required" ? "error" : "info",
    });
  }
  return annotations;
}

/**
 * Resolve the `<Overlay>` blocks inside `screenId` against the MDX
 * file's stored `annot:snapshot` block and return a typed
 * annotation array ready to feed into
 * `createAnnotator().toEditablePng()`.
 *
 * Used by the Playwright screenshot hook (Tier C) and the Astro
 * Image Service (Tier B-render). Throws the same diagnostics
 * `renderAnnotatedScreen` would (no annot frontmatter / no
 * matching `<Screen id>`).
 *
 * Returns an empty array when no `<Overlay>` matches a bbox marker
 * — e.g. the snapshot was never captured, or `<Overlay match>`
 * targets an element that's no longer in the page.
 */
export async function resolveMdxAnnotations(opts: {
  mdxPath: string;
  screenId: string;
  dims: { width: number; height: number };
  cwd?: string;
}): Promise<BboxNumberedBadgeAnnotation[]> {
  const cwd = opts.cwd ?? process.cwd();
  const mdxAbs = isAbsolute(opts.mdxPath) ? opts.mdxPath : resolve(cwd, opts.mdxPath);
  const parsed = await parseMdxFile(mdxAbs);
  if (!parsed) {
    throw new Error(
      `resolveMdxAnnotations: ${opts.mdxPath} has no \`annot:\` frontmatter — cannot resolve.`,
    );
  }
  const screen = parsed.screens.find((s) => s.id === opts.screenId);
  if (!screen) {
    throw new Error(
      `resolveMdxAnnotations: ${opts.mdxPath} has no <Screen id="${opts.screenId}"> block.`,
    );
  }
  const bboxes = parseSnapshotBoxes(parsed.commentBlocks.snapshot ?? "");
  return buildBadgeAnnotations(screen.overlays, bboxes, opts.dims);
}

/**
 * Wrap a `BboxNumberedBadgeAnnotation[]` (or any compatible badge
 * subset) into a single-root `<svg>` ready for the annotator's
 * `annotationsSvg` input.
 *
 * Mirrors the more general `svgFromBboxAnnotations` below but
 * stays specifically typed to the badge shape so the Astro Image
 * Service's `buildBadgeAnnotations()` output flows in without an
 * extra cast.
 */
export function svgFromBadges(badges: BboxNumberedBadgeAnnotation[]): string {
  // `bboxAnnotationsToSvg` returns a multi-root fragment
  // (`<rect/><circle/><text/>` per badge); the annotator's
  // sanitiser expects a single-root SVG document and silently
  // drops the siblings otherwise. Wrap in an `<svg>` so all
  // primitives survive into the composited output.
  const fragment = bboxAnnotationsToSvg(badges);
  return `<svg xmlns="http://www.w3.org/2000/svg">${fragment}</svg>`;
}

/**
 * Wrap a generic `BboxAnnotation[]` (the union DSL accepted by
 * `@ingcreators/annot-annotator`) into a single-root `<svg>` ready
 * for the annotator's `annotationsSvg` input. Mirrors `svgFromBadges`
 * but stays type-permissive — the Playwright fixture's inline
 * overlays can be any `BboxAnnotation` shape, not just numbered
 * badges.
 *
 * Returns the empty wrapper `<svg/>` when `annotations` is empty —
 * lets the editor open the file with no annotations layer rather
 * than throwing.
 */
export function svgFromBboxAnnotations(annotations: BboxAnnotation[]): string {
  if (annotations.length === 0) return emptyAnnotationsSvg();
  const fragment = bboxAnnotationsToSvg(annotations);
  return `<svg xmlns="http://www.w3.org/2000/svg">${fragment}</svg>`;
}

/**
 * Minimal SVG fragment for the "editable wrap, no overlays" case.
 * The editor's import path reads `annotationsSvg` from the XMP and
 * reconstructs an empty annotations layer — fine to be wrapper-only.
 */
export function emptyAnnotationsSvg(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
}
