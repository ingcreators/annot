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
  type BBox,
  type BboxAnnotation,
  type BboxArrowAnnotation,
  type BboxCalloutAnnotation,
  type BboxCircleAnnotation,
  type BboxFocusMaskAnnotation,
  type BboxFreehandAnnotation,
  type BboxNumberedBadgeAnnotation,
  type BboxRectAnnotation,
  type BboxRedactRegion,
  type BboxTextAnnotation,
  bboxAnnotationsToSvg,
  type Intent,
} from "@ingcreators/annot-annotator";
import { type ElementTree, walkTree } from "@ingcreators/annot-core";

import type {
  AnnotationBBox,
  AnnotationSpec,
  AnnotationStyleFields,
  ArrowEndpoint,
  OverlayEntry,
} from "./annotations-yaml.js";
import { parseMdxFile } from "./mdx.js";
import type { MatchKey, OverlayIntent, OverlaySpec } from "./types.js";

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
 * Convert an `ElementTree` (Phase 1a of
 * `docs/plans/living-spec-authoring-roadmap.md`) into the same
 * `BoxedEntry[]` shape `parseSnapshotBoxes` emits, so the Astro
 * Image Service + Playwright screenshot hook can resolve
 * `<Overlay match>` against PNG XMP-stored trees with no
 * additional code path.
 *
 * Only nodes with both `name` and `bbox` populated produce
 * entries — matches the legacy YAML parser's filter (boxed +
 * referenced entries with a name). Decorative containers and
 * synthetic roots are skipped.
 *
 * Phase 1h of the roadmap. Lives alongside `parseSnapshotBoxes`
 * so consumers that prefer one input shape don't need to know
 * about the other.
 */
export function elementTreeToBoxedEntries(tree: ElementTree): BoxedEntry[] {
  const out: BoxedEntry[] = [];
  walkTree(tree, (node) => {
    if (!node.bbox) return;
    if (!node.name) return;
    out.push({
      role: node.role,
      name: node.name,
      ref: node.ref,
      box: node.bbox,
    });
  });
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
 * Sibling of {@link buildBadgeAnnotations} that takes yaml-form
 * {@link OverlayEntry} objects. Phase 2b of
 * `docs/plans/living-spec-authoring-roadmap.md` — the Image Service
 * resolves a `<Screen annotations="…">` block against this entry
 * point instead of the legacy inline `<Overlay>` path.
 *
 * Entries without a matching boxed entry are skipped silently —
 * the drift detector (Phase 2c) surfaces them as findings upstream.
 */
export function buildBadgeAnnotationsFromYaml(
  overlays: readonly OverlayEntry[],
  boxed: readonly BoxedEntry[],
  dims: { width: number; height: number },
): BboxNumberedBadgeAnnotation[] {
  const annotations: BboxNumberedBadgeAnnotation[] = [];
  for (const overlay of overlays) {
    const entry = boxed.find((b) => b.role === overlay.match.role && b.name === overlay.match.name);
    if (!entry) continue;
    annotations.push({
      type: "numberedBadge",
      bbox: entry.box,
      number: overlay.number,
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
 * Phase 3c of `docs/plans/living-spec-authoring-roadmap.md`.
 * Resolve each Phase 3a `AnnotationSpec` against the page's
 * boxed entries + image dimensions and convert to the
 * `BboxAnnotation` shape `bboxAnnotationsToSvg` consumes.
 *
 * Skips entries whose required `match` (or the matches inside
 * `coversElements` / `from` / `to` / `target` / `cutout`) can't
 * be resolved — the drift detector (Phase 3d) surfaces those
 * upstream. Free-coord entries (`bbox` / `point` / `at` / `path`
 * / `center`) always resolve.
 */
export function buildShapeAnnotationsFromYaml(
  annotations: readonly AnnotationSpec[],
  boxed: readonly BoxedEntry[],
  dims: { width: number; height: number },
): BboxAnnotation[] {
  const out: BboxAnnotation[] = [];
  for (const spec of annotations) {
    const mapped = mapAnnotation(spec, boxed, dims);
    if (mapped) out.push(mapped);
  }
  return out;
}

/**
 * Phase 3g of `docs/plans/living-spec-authoring-roadmap.md`
 * (Phase 3 follow-up). Walk `annotations[]` for `redact` entries
 * whose `style` is a raster transform (`mosaic` / `blur`),
 * resolve each cutout to a bbox, and emit `BboxRedactRegion[]`
 * ready for `burnRedactions` from `@ingcreators/annot-annotator`.
 *
 * Entries with `style: solid` (or undefined / unset) are skipped
 * here — the SVG-fragment path
 * ({@link buildShapeAnnotationsFromYaml}) handles those as
 * filled rects. Match-anchored entries whose `match` doesn't
 * resolve are skipped silently (drift detector surfaces them
 * upstream).
 *
 * Returns the regions in document order; `burnRedactions`
 * applies them in that order with later regions overlaying
 * earlier ones (no alpha-blending), so authors can express
 * "mosaic, then opaque overlay on top" combinations by
 * sequencing entries.
 */
export function buildRasterRedactRegionsFromYaml(
  annotations: readonly AnnotationSpec[],
  boxed: readonly BoxedEntry[],
): BboxRedactRegion[] {
  const out: BboxRedactRegion[] = [];
  for (const spec of annotations) {
    if (spec.kind !== "redact") continue;
    if (spec.style !== "mosaic" && spec.style !== "blur") continue;
    let bbox: BBox | null = null;
    if (spec.match) {
      const entry = findBoxed(boxed, spec.match);
      if (!entry) continue;
      bbox = entry.box;
    } else if (spec.bbox) {
      bbox = spec.bbox;
    }
    if (!bbox) continue;
    const region: BboxRedactRegion = { bbox, style: spec.style };
    // The annotator's `burnRedactions` only honours `color` on
    // `style: solid`. Mosaic / blur ignore it; pass through
    // anyway for forward-compat (a future blur tint or similar
    // could pick it up without a wire-format change).
    if (spec.color !== undefined) region.color = spec.color;
    out.push(region);
  }
  return out;
}

function mapAnnotation(
  spec: AnnotationSpec,
  boxed: readonly BoxedEntry[],
  dims: { width: number; height: number },
): BboxAnnotation | null {
  switch (spec.kind) {
    case "rect":
      return mapRect(spec, boxed);
    case "circle":
      return mapCircle(spec, boxed);
    case "arrow":
      return mapArrow(spec, boxed);
    case "text":
      return mapText(spec, boxed);
    case "callout":
      return mapCallout(spec, boxed);
    case "freehand":
      return mapFreehand(spec);
    case "redact":
      return mapRedact(spec, boxed);
    case "focusMask":
      return mapFocusMask(spec, boxed, dims);
  }
}

function mapRect(
  spec: Extract<AnnotationSpec, { kind: "rect" }>,
  boxed: readonly BoxedEntry[],
): BboxRectAnnotation | null {
  let bbox: BBox | null = null;
  if (spec.match) {
    const entry = findBoxed(boxed, spec.match);
    if (!entry) return null;
    bbox = entry.box;
  } else if (spec.coversElements) {
    const boxes: BBox[] = [];
    for (const m of spec.coversElements) {
      const entry = findBoxed(boxed, m);
      if (!entry) return null;
      boxes.push(entry.box);
    }
    bbox = unionBoxes(boxes);
  } else if (spec.bbox) {
    bbox = spec.bbox;
  }
  if (!bbox) return null;
  return withStyle({ type: "rect", bbox }, spec);
}

function mapCircle(
  spec: Extract<AnnotationSpec, { kind: "circle" }>,
  boxed: readonly BoxedEntry[],
): BboxCircleAnnotation | null {
  if (spec.match) {
    const entry = findBoxed(boxed, spec.match);
    if (!entry) return null;
    const center = bboxCenter(entry.box);
    // Match-anchored circle defaults to a radius matching the
    // element's bounding half-circle, so a square element gets a
    // circle that just covers it. Authors can override via
    // `radius` in yaml.
    const radius = spec.radius ?? Math.max(entry.box.width, entry.box.height) / 2;
    return withStyle({ type: "circle", center, radius }, spec);
  }
  if (spec.center && spec.radius !== undefined) {
    return withStyle({ type: "circle", center: spec.center, radius: spec.radius }, spec);
  }
  return null;
}

function mapArrow(
  spec: Extract<AnnotationSpec, { kind: "arrow" }>,
  boxed: readonly BoxedEntry[],
): BboxArrowAnnotation | null {
  const from = resolveEndpoint(spec.from, boxed);
  if (!from) return null;
  const to = resolveEndpoint(spec.to, boxed);
  if (!to) return null;
  return withStyle({ type: "arrow", from, to }, spec);
}

function resolveEndpoint(
  ep: ArrowEndpoint,
  boxed: readonly BoxedEntry[],
): { x: number; y: number } | null {
  if ("point" in ep) return ep.point;
  const entry = findBoxed(boxed, ep.match);
  if (!entry) return null;
  return bboxCenter(entry.box);
}

/**
 * Text-anchor offset in image pixels per `position`. Chosen so
 * the text sits visibly outside the element bbox without
 * overlapping the element itself.
 */
const TEXT_ANCHOR_PADDING = 8;

function mapText(
  spec: Extract<AnnotationSpec, { kind: "text" }>,
  boxed: readonly BoxedEntry[],
): BboxTextAnnotation | null {
  let at: { x: number; y: number };
  let anchor: BboxTextAnnotation["anchor"];
  if (spec.anchor) {
    const entry = findBoxed(boxed, spec.anchor.match);
    if (!entry) return null;
    const placed = placeTextRelativeToBbox(entry.box, spec.anchor.position ?? "above");
    at = placed.at;
    anchor = placed.anchor;
  } else if (spec.at) {
    at = spec.at;
    anchor = "start";
  } else {
    return null;
  }
  const base: BboxTextAnnotation = {
    type: "text",
    at,
    content: spec.text,
    anchor,
  };
  if (spec.fontSize !== undefined) base.fontSize = spec.fontSize;
  return withStyle(base, spec);
}

function placeTextRelativeToBbox(
  bbox: BBox,
  position: "above" | "below" | "left" | "right" | "center",
): { at: { x: number; y: number }; anchor: BboxTextAnnotation["anchor"] } {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  switch (position) {
    case "above":
      return { at: { x: cx, y: bbox.y - TEXT_ANCHOR_PADDING }, anchor: "middle" };
    case "below":
      return {
        at: { x: cx, y: bbox.y + bbox.height + TEXT_ANCHOR_PADDING },
        anchor: "middle",
      };
    case "left":
      return { at: { x: bbox.x - TEXT_ANCHOR_PADDING, y: cy }, anchor: "end" };
    case "right":
      return {
        at: { x: bbox.x + bbox.width + TEXT_ANCHOR_PADDING, y: cy },
        anchor: "start",
      };
    case "center":
      return { at: { x: cx, y: cy }, anchor: "middle" };
  }
}

function mapCallout(
  spec: Extract<AnnotationSpec, { kind: "callout" }>,
  boxed: readonly BoxedEntry[],
): BboxCalloutAnnotation | null {
  let targetBbox: BBox | null = null;
  if ("match" in spec.target) {
    const entry = findBoxed(boxed, spec.target.match);
    if (!entry) return null;
    targetBbox = entry.box;
  } else {
    targetBbox = spec.target.bbox;
  }
  return withStyle({ type: "callout", at: spec.at, targetBbox, content: spec.text }, spec);
}

function mapFreehand(spec: Extract<AnnotationSpec, { kind: "freehand" }>): BboxFreehandAnnotation {
  return withStyle({ type: "freehand", path: spec.path }, spec);
}

/**
 * Solid-style redact = filled rect with opaque fill + no stroke.
 * Yaml-supplied `fill` wins over the intent default; if unset we
 * fall back to a neutral dark grey so the redact reads as
 * "censored" even without a custom colour.
 */
const REDACT_DEFAULT_FILL = "#222222";

/**
 * Map a `redact` annotation to its `BboxAnnotation` SVG-fragment
 * representation.
 *
 * Only `style: "solid"` (or the unset default, which the renderer
 * treats as solid) produces an output here. `style: "mosaic"` and
 * `style: "blur"` are raster-pixel transforms that can't be
 * expressed as an SVG fragment — the Astro Image Service routes
 * them through `burnRedactions` from `@ingcreators/annot-annotator`
 * BEFORE SVG composition. See `buildRasterRedactRegionsFromYaml`
 * below for the raster-path companion.
 *
 * Returning `null` for mosaic / blur ensures they don't double-bake
 * as a filled rect on top of the already-pixelated bitmap.
 */
function mapRedact(
  spec: Extract<AnnotationSpec, { kind: "redact" }>,
  boxed: readonly BoxedEntry[],
): BboxRectAnnotation | null {
  if (spec.style === "mosaic" || spec.style === "blur") {
    // Raster path consumes this entry instead — see
    // `buildRasterRedactRegionsFromYaml`.
    return null;
  }
  let bbox: BBox | null = null;
  if (spec.match) {
    const entry = findBoxed(boxed, spec.match);
    if (!entry) return null;
    bbox = entry.box;
  } else if (spec.bbox) {
    bbox = spec.bbox;
  }
  if (!bbox) return null;
  // Render as a filled rect (solid style — the SVG path). Honour
  // explicit `fill` / `stroke` overrides; default to opaque
  // dark grey + no stroke so the redact looks like a censor bar.
  return {
    type: "rect",
    bbox,
    fill: spec.fill ?? REDACT_DEFAULT_FILL,
    stroke: spec.stroke ?? "none",
    strokeWidth: spec.strokeWidth ?? 0,
    ...(spec.intent ? { intent: mapIntent(spec.intent) } : {}),
  };
}

function mapFocusMask(
  spec: Extract<AnnotationSpec, { kind: "focusMask" }>,
  boxed: readonly BoxedEntry[],
  dims: { width: number; height: number },
): BboxFocusMaskAnnotation | null {
  let cutout: BBox | null = null;
  if ("match" in spec.cutout) {
    const entry = findBoxed(boxed, spec.cutout.match);
    if (!entry) return null;
    const padding = spec.cutout.padding ?? 0;
    cutout = expandBbox(entry.box, padding);
  } else {
    cutout = spec.cutout.bbox;
  }
  const base: BboxFocusMaskAnnotation = {
    type: "focusMask",
    cutout,
    imageWidth: dims.width,
    imageHeight: dims.height,
  };
  if (spec.dimColor !== undefined) base.dimColor = spec.dimColor;
  return withStyle(base, spec);
}

// ─── shared helpers ────────────────────────────────────────────

function findBoxed(boxed: readonly BoxedEntry[], match: MatchKey): BoxedEntry | undefined {
  return boxed.find((b) => b.role === match.role && b.name === match.name);
}

function bboxCenter(b: BBox): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function unionBoxes(boxes: readonly BBox[]): BBox {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function expandBbox(b: AnnotationBBox, padding: number): BBox {
  if (padding <= 0) return b;
  return {
    x: b.x - padding,
    y: b.y - padding,
    width: b.width + padding * 2,
    height: b.height + padding * 2,
  };
}

/**
 * Map the docs flavour `OverlayIntent` (`required` / `action` /
 * generic) onto the annotator DSL's `Intent` enum
 * (`info` / `warning` / `error` / `success` / `neutral`).
 *
 * Mirrors the existing mapping in `buildBadgeAnnotations` /
 * `buildBadgeAnnotationsFromYaml` so an `intent: "required"` /
 * `intent: "action"` annotation renders in the same colour as
 * an equally-flavoured overlay badge.
 */
function mapIntent(intent: OverlayIntent | undefined): Intent | undefined {
  if (intent === undefined) return undefined;
  switch (intent) {
    case "required":
      return "error";
    case "action":
      return "warning";
    case "info":
    case "warning":
    case "error":
    case "success":
    case "neutral":
      return intent;
  }
}

/**
 * Apply the style fields from a Phase 3a `AnnotationSpec` onto a
 * partially-built `BboxAnnotation`. Only sets fields that are
 * defined on the spec — keeps the renderer's intent-derived
 * defaults active for fields the author left blank.
 */
function withStyle<T extends BboxAnnotation>(base: T, src: AnnotationStyleFields): T {
  const mapped = mapIntent(src.intent);
  const out: BboxAnnotation = { ...base };
  if (mapped !== undefined && "intent" in out === false) {
    (out as { intent?: Intent }).intent = mapped;
  }
  // The base type may already carry intent (we forward it from
  // the spec); the conditional above protects against doubling.
  if (mapped !== undefined && (out as { intent?: Intent }).intent === undefined) {
    (out as { intent?: Intent }).intent = mapped;
  }
  if (src.stroke !== undefined) (out as { stroke?: string }).stroke = src.stroke;
  if (src.strokeWidth !== undefined)
    (out as { strokeWidth?: number }).strokeWidth = src.strokeWidth;
  if (src.fill !== undefined) (out as { fill?: string }).fill = src.fill;
  if (src.color !== undefined) (out as { color?: string }).color = src.color;
  return out as T;
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
