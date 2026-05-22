/**
 * Annotation yaml — Tier A data model for the `.annotations.yaml`
 * files Phase 2 of
 * [`docs/plans/living-spec-authoring-roadmap.md`](../../../docs/plans/living-spec-authoring-roadmap.md)
 * extracts from the legacy inline `<Overlay>` JSX.
 *
 * Wire format:
 *
 * ```yaml
 * version: 1
 *
 * # Phase 2 — numbered-badge callouts. Each entry has a paired
 * # <AnnotCallout for="id"> description block in MDX.
 * overlays:
 *   - id: o1
 *     kind: numberedBadge
 *     match: { role: "textbox", name: "Email" }
 *     intent: required
 *     number: 1
 *
 * # Phase 3 — full visual palette. Each entry composes onto the PNG
 * # but has NO MDX description slot (annotations[].id is never
 * # referenced from <AnnotCallout for>).
 * annotations:
 *   - id: a1
 *     kind: arrow
 *     from: { match: { role: "textbox", name: "Email" } }
 *     to:   { match: { role: "button", name: "Sign in" } }
 *     intent: action
 *   - id: a2
 *     kind: focusMask
 *     cutout: { match: { role: "button", name: "Sign in" }, padding: 8 }
 * ```
 *
 * The file lives next to (or near) the PNG it annotates and is
 * referenced from MDX via
 * `<AnnotFigure annotations="login.annotations.yaml">`.
 *
 * Match keys reuse [`MatchKey`](./types.ts) so the resolver path is
 * shared with the legacy `<Overlay>` resolver. Intents reuse
 * [`OverlayIntent`](./types.ts).
 *
 * Pure Tier A — no DOM, no Node-only APIs; safe to import from
 * `@ingcreators/annot-product-docs`'s headless surface.
 */

import { dump as yamlDump, load as yamlLoad } from "js-yaml";
import type { MatchKey, OverlayIntent } from "./types.js";

/**
 * Current schema version. Per OQ-01 of the roadmap, future v2 / v3
 * bumps go through strict version dispatch (the parser refuses
 * unknown majors); within v1, additive optional fields are allowed
 * without a version bump.
 */
export const ANNOTATIONS_YAML_VERSION = 1 as const;

/**
 * One numbered-badge overlay entry. Phase 2 supports `numberedBadge`
 * only; Phase 3 of the roadmap extends `OverlayEntry` (and adds a
 * sibling `AnnotationSpec`) for the full annotation palette
 * (`rect` / `arrow` / `text` / `freehand` / `redact` / etc.).
 *
 * The shape mirrors the legacy {@link OverlaySpec} from `./types.ts`
 * minus the inline `body` field — descriptions live in MDX
 * `<AnnotCallout for="id">body</AnnotCallout>` blocks now, not in
 * the yaml.
 */
export interface OverlayEntry {
  /**
   * Stable identifier targeted by `<AnnotCallout for="id">` in MDX.
   * Author-supplied; the migration CLI (Phase 2d) defaults to
   * `o1` / `o2` / … in `overlays[]` index order.
   */
  id: string;
  /**
   * Discriminator — Phase 2 ships `numberedBadge` only. Adding a
   * new kind here means extending the renderer in `AnnotFigure.astro`
   * AND the drift validator in `./drift.ts`.
   */
  kind: "numberedBadge";
  /** Match key used to locate the element in the page's ElementTree. */
  match: MatchKey;
  /** Optional intent flavour for the rendered callout / border. */
  intent?: OverlayIntent;
  /**
   * Numeric badge label rendered on the image. Author-supplied so
   * the same yaml renders consistent numbering across re-captures
   * even if `overlays[]` order changes. Required by the Astro
   * Image Service today; future kinds may make it optional.
   */
  number: number;
}

/**
 * Top-level wire shape for an `.annotations.yaml` file.
 *
 * `overlays[]` carries the numbered-badge entries the docs flow
 * pairs with `<AnnotCallout for="id">` description blocks
 * (Phase 2). `annotations[]` carries the wider visual palette
 * (Phase 3 of the roadmap) — entries are pure visual marking
 * with no MDX description slot; their `id` is self-contained
 * and is NEVER targeted by `<AnnotCallout for>`.
 *
 * Both arrays default to empty when absent. Within v1 the
 * `annotations[]` extension is additive: pre-Phase-3 files
 * (no `annotations` key) keep parsing unchanged.
 *
 * `meta` is an open string map reserved for downstream tooling
 * (book grouping, generator IDs, etc.) — readers must ignore
 * unknown keys.
 */
export interface AnnotationsFile {
  version: typeof ANNOTATIONS_YAML_VERSION;
  overlays: OverlayEntry[];
  /**
   * Phase 3 of `docs/plans/living-spec-authoring-roadmap.md`.
   * Optional sibling of `overlays[]` carrying the full visual
   * palette (arrows / rects / text labels / callouts / freehand
   * strokes / redact rects / focus masks). Each entry composes
   * onto the annotated PNG but has no MDX `<AnnotCallout>`
   * counterpart.
   */
  annotations?: AnnotationSpec[];
  /** Optional free-form metadata. Readers ignore unknown keys. */
  meta?: Record<string, string>;
}

// ─── Phase 3 — annotations[] palette ───────────────────────────

/**
 * Common style fields any annotation kind may carry. Mirrors the
 * `AnnotationStyle` shape in `@ingcreators/annot-annotator`'s DSL
 * so the yaml → `BboxAnnotation` mapper (Phase 3c) flows straight
 * through. Inlined here rather than imported so this Tier A module
 * stays free of the annotator dependency at parse time.
 */
export interface AnnotationStyleFields {
  /** Semantic colour shorthand. Renderer maps to design-system tokens. */
  intent?: OverlayIntent;
  /** CSS stroke colour override (wins over `intent`-derived default). */
  stroke?: string;
  /** Stroke width in image pixels. */
  strokeWidth?: number;
  /** CSS fill colour override (wins over `intent`-derived default). */
  fill?: string;
  /** CSS text-fill colour override. */
  color?: string;
}

/** Axis-aligned bbox in page (image) pixels. */
export interface AnnotationBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Point in page (image) pixels. */
export interface AnnotationPoint {
  x: number;
  y: number;
}

/**
 * Where a text label sits relative to its anchor element. The
 * renderer picks a sensible offset (image-pixel padding) per
 * position. Default `above`.
 */
export type TextAnchorPosition = "above" | "below" | "left" | "right" | "center";

/**
 * Outline (or filled) rect that highlights one element, a group of
 * elements (bbox = union), or a free-coord region.
 *
 * Exactly one of `match` / `coversElements` / `bbox` is required;
 * the parser rejects entries that supply zero or multiple.
 */
export interface RectAnnotation extends AnnotationStyleFields {
  id: string;
  kind: "rect";
  match?: MatchKey;
  coversElements?: MatchKey[];
  bbox?: AnnotationBBox;
}

/**
 * Circle centred on an element (radius derived from the element's
 * bbox half-width) or on a free-coord point.
 */
export interface CircleAnnotation extends AnnotationStyleFields {
  id: string;
  kind: "circle";
  /** Element to centre the circle on. Mutually exclusive with `center`. */
  match?: MatchKey;
  /** Free-coord centre. Mutually exclusive with `match`. */
  center?: AnnotationPoint;
  /**
   * Radius in image pixels. Required for the `center` form;
   * optional override for the `match` form (defaults to half the
   * element's bbox width).
   */
  radius?: number;
}

/** Arrow endpoint — either match-anchored or free-coord. */
export type ArrowEndpoint = { match: MatchKey } | { point: AnnotationPoint };

/** Arrow between two endpoints. */
export interface ArrowAnnotation extends AnnotationStyleFields {
  id: string;
  kind: "arrow";
  from: ArrowEndpoint;
  to: ArrowEndpoint;
}

/**
 * Text label anchored to an element or placed at a free-coord
 * point. Exactly one of `anchor` / `at` is required.
 */
export interface TextAnnotation extends AnnotationStyleFields {
  id: string;
  kind: "text";
  text: string;
  /** Match-anchored. The renderer offsets per `position`. */
  anchor?: { match: MatchKey; position?: TextAnchorPosition };
  /** Free-coord placement. */
  at?: AnnotationPoint;
  /** Font size in image pixels. Default `14`. */
  fontSize?: number;
}

/** Callout target — either match-anchored or free-coord. */
export type CalloutTarget = { match: MatchKey } | { bbox: AnnotationBBox };

/**
 * Callout = target outline + caption text + arrow from caption to
 * target. The caption sits at `at`; the target highlights at
 * `target` (resolved to a bbox via match or supplied directly).
 */
export interface CalloutAnnotation extends AnnotationStyleFields {
  id: string;
  kind: "callout";
  text: string;
  target: CalloutTarget;
  /** Caption text position. Required for now (auto-placement is a future enhancement). */
  at: AnnotationPoint;
}

/**
 * Free-form path. Always free-coord — UI changes may misalign
 * it; the editor's drift detector intentionally skips it.
 */
export interface FreehandAnnotation extends AnnotationStyleFields {
  id: string;
  kind: "freehand";
  /** SVG path data — `M` / `L` / `C` / `Q` / `Z` commands. */
  path: string;
}

/**
 * Opaque rect obscuring content. Phase 3 ships `style: "solid"`
 * only — mosaic / blur need raster pixel access (out of scope
 * for the SVG-fragment Image Service); the parser rejects other
 * values for now.
 */
export interface RedactAnnotation extends AnnotationStyleFields {
  id: string;
  kind: "redact";
  match?: MatchKey;
  bbox?: AnnotationBBox;
  /** Phase 3 ships `solid` only. */
  style?: "solid";
}

/** Focus-mask cutout — element-anchored (with optional padding) or free-coord bbox. */
export type FocusMaskCutout = { match: MatchKey; padding?: number } | { bbox: AnnotationBBox };

/**
 * Darken everything EXCEPT the cutout region. The cutout draws
 * crisp; everything outside is dimmed by `dimColor`
 * (default `rgba(0,0,0,0.5)`).
 */
export interface FocusMaskAnnotation extends AnnotationStyleFields {
  id: string;
  kind: "focusMask";
  cutout: FocusMaskCutout;
  /** CSS colour for the dim layer. Default `rgba(0,0,0,0.5)`. */
  dimColor?: string;
}

/**
 * Discriminated union across every annotation kind Phase 3
 * supports. Parser dispatches on `kind`; serializer round-trips
 * to YAML and back to a byte-equivalent object.
 */
export type AnnotationSpec =
  | RectAnnotation
  | CircleAnnotation
  | ArrowAnnotation
  | TextAnnotation
  | CalloutAnnotation
  | FreehandAnnotation
  | RedactAnnotation
  | FocusMaskAnnotation;

/** The `kind` literal type. */
export type AnnotationKind = AnnotationSpec["kind"];

/** Set of every supported `kind`. Reused by the parser + drift detector. */
export const ANNOTATION_KINDS: readonly AnnotationKind[] = [
  "rect",
  "circle",
  "arrow",
  "text",
  "callout",
  "freehand",
  "redact",
  "focusMask",
] as const;

/**
 * Error thrown when a YAML payload cannot be parsed into the
 * documented schema. Carries the offending source so callers can
 * surface line / column context (the CLI prefixes path + heading).
 */
export class AnnotationsYamlError extends Error {
  constructor(
    message: string,
    readonly source?: string,
  ) {
    super(message);
    this.name = "AnnotationsYamlError";
  }
}

/**
 * Parse a YAML string into an `AnnotationsFile`. Throws
 * {@link AnnotationsYamlError} on shape violations: missing
 * `version`, unsupported major, missing required `id` / `kind` /
 * `match` / `number` on an overlay entry.
 *
 * The parser is permissive about optional fields: unknown keys at
 * any level are dropped silently (forward compat within a major).
 */
export function parseAnnotationsYaml(source: string): AnnotationsFile {
  let raw: unknown;
  try {
    raw = yamlLoad(source);
  } catch (err) {
    throw new AnnotationsYamlError(
      `Failed to parse annotations yaml: ${(err as Error).message}`,
      source,
    );
  }
  if (!raw || typeof raw !== "object") {
    throw new AnnotationsYamlError("Annotations yaml must be a mapping", source);
  }
  const obj = raw as Record<string, unknown>;
  const version = obj["version"];
  if (version !== ANNOTATIONS_YAML_VERSION) {
    throw new AnnotationsYamlError(
      `Unsupported annotations yaml version: expected ${ANNOTATIONS_YAML_VERSION}, got ${JSON.stringify(version)}`,
      source,
    );
  }
  const overlaysRaw = obj["overlays"];
  if (!Array.isArray(overlaysRaw)) {
    throw new AnnotationsYamlError("Annotations yaml `overlays` must be an array", source);
  }
  const overlays = overlaysRaw.map((entry, i) => coerceOverlay(entry, i));

  const result: AnnotationsFile = {
    version: ANNOTATIONS_YAML_VERSION,
    overlays,
  };

  // Phase 3: `annotations[]` is the optional sibling palette.
  // Absent means "no Phase 3 entries" — keeps pre-Phase-3 files
  // parsing unchanged. When present it must be an array; the
  // parser dispatches per `kind` and rejects unknown values.
  const annotationsRaw = obj["annotations"];
  if (annotationsRaw !== undefined) {
    if (!Array.isArray(annotationsRaw)) {
      throw new AnnotationsYamlError("Annotations yaml `annotations` must be an array", source);
    }
    const annotations = annotationsRaw.map((entry, i) => coerceAnnotation(entry, i));
    if (annotations.length > 0) result.annotations = annotations;
  }

  const meta = obj["meta"];
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    if (Object.keys(out).length > 0) result.meta = out;
  }
  return result;
}

/**
 * Serialize an `AnnotationsFile` back to YAML. Output is
 * deterministic (`version` → `overlays` → `meta`), suitable for
 * round-trip + git-diff use.
 *
 * The serializer rejects entries that wouldn't round-trip through
 * `parseAnnotationsYaml` — kind is checked at the type level, but
 * missing `id` / `match` / `number` at runtime throws.
 */
export function serializeAnnotationsYaml(file: AnnotationsFile): string {
  for (const o of file.overlays) {
    if (typeof o.id !== "string" || o.id.length === 0) {
      throw new AnnotationsYamlError(`Overlay entry missing id: ${JSON.stringify(o)}`);
    }
    if (!o.match || typeof o.match.role !== "string" || typeof o.match.name !== "string") {
      throw new AnnotationsYamlError(`Overlay entry ${o.id}: match must have string role + name`);
    }
    if (typeof o.number !== "number" || !Number.isFinite(o.number)) {
      throw new AnnotationsYamlError(`Overlay entry ${o.id}: number must be a finite number`);
    }
  }
  // Phase 3: validate `annotations[]` in-memory invariants. The
  // per-variant `validateAnnotation` mirrors what the parser
  // accepts — anything serialised here must round-trip back.
  if (file.annotations) {
    for (const a of file.annotations) {
      validateAnnotation(a);
    }
  }
  const payload: Record<string, unknown> = {
    version: file.version,
    overlays: file.overlays.map(serializeOverlay),
  };
  if (file.annotations && file.annotations.length > 0) {
    payload["annotations"] = file.annotations.map(serializeAnnotation);
  }
  if (file.meta && Object.keys(file.meta).length > 0) {
    payload["meta"] = { ...file.meta };
  }
  // `lineWidth: -1` disables `js-yaml`'s folded-string wrapping so
  // names with spaces stay on one line (matches the inline-map style
  // shown in the roadmap's example).
  return yamlDump(payload, { lineWidth: -1, noRefs: true, sortKeys: false });
}

function coerceOverlay(entry: unknown, index: number): OverlayEntry {
  if (!entry || typeof entry !== "object") {
    throw new AnnotationsYamlError(`Overlay #${index}: not a mapping`);
  }
  const o = entry as Record<string, unknown>;
  const id = o["id"];
  if (typeof id !== "string" || id.length === 0) {
    throw new AnnotationsYamlError(`Overlay #${index}: missing or empty id`);
  }
  const kind = o["kind"];
  if (kind !== "numberedBadge") {
    throw new AnnotationsYamlError(
      `Overlay ${id}: unsupported kind ${JSON.stringify(kind)} (expected "numberedBadge")`,
    );
  }
  const match = coerceMatch(o["match"], id);
  const number = o["number"];
  if (typeof number !== "number" || !Number.isFinite(number)) {
    throw new AnnotationsYamlError(`Overlay ${id}: number must be a finite number`);
  }
  const out: OverlayEntry = { id, kind: "numberedBadge", match, number };
  const intent = o["intent"];
  if (typeof intent === "string") {
    out.intent = intent as OverlayIntent;
  }
  return out;
}

function coerceMatch(raw: unknown, ownerId: string): MatchKey {
  if (!raw || typeof raw !== "object") {
    throw new AnnotationsYamlError(`Overlay ${ownerId}: match must be a mapping`);
  }
  const m = raw as Record<string, unknown>;
  const role = m["role"];
  const name = m["name"];
  if (typeof role !== "string" || typeof name !== "string") {
    throw new AnnotationsYamlError(
      `Overlay ${ownerId}: match.role and match.name must both be strings`,
    );
  }
  const out: MatchKey = { role, name };
  if (m["under"] !== undefined) {
    out.under = coerceMatch(m["under"], ownerId);
  }
  return out;
}

function serializeOverlay(o: OverlayEntry): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: o.id,
    kind: o.kind,
    match: serializeMatch(o.match),
  };
  if (o.intent !== undefined) payload["intent"] = o.intent;
  payload["number"] = o.number;
  return payload;
}

function serializeMatch(m: MatchKey): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role, name: m.name };
  if (m.under) out["under"] = serializeMatch(m.under);
  return out;
}

// ─── Phase 3 — annotations[] coerce + serialize ────────────────

/**
 * Coerce one raw mapping into a typed `AnnotationSpec`. Dispatches
 * on `kind`; per-kind branches verify mandatory fields, mutually-
 * exclusive selectors (`match` vs `bbox` vs `coversElements` for
 * rect, etc.), and parse free-coord shapes.
 */
function coerceAnnotation(raw: unknown, index: number): AnnotationSpec {
  if (!raw || typeof raw !== "object") {
    throw new AnnotationsYamlError(`Annotation #${index}: not a mapping`);
  }
  const a = raw as Record<string, unknown>;
  const id = a["id"];
  if (typeof id !== "string" || id.length === 0) {
    throw new AnnotationsYamlError(`Annotation #${index}: missing or empty id`);
  }
  const kind = a["kind"];
  if (typeof kind !== "string" || !ANNOTATION_KINDS.includes(kind as AnnotationKind)) {
    throw new AnnotationsYamlError(
      `Annotation ${id}: unsupported kind ${JSON.stringify(kind)} (expected one of ${ANNOTATION_KINDS.join(", ")})`,
    );
  }

  switch (kind as AnnotationKind) {
    case "rect":
      return coerceRect(id, a);
    case "circle":
      return coerceCircle(id, a);
    case "arrow":
      return coerceArrow(id, a);
    case "text":
      return coerceText(id, a);
    case "callout":
      return coerceCallout(id, a);
    case "freehand":
      return coerceFreehand(id, a);
    case "redact":
      return coerceRedact(id, a);
    case "focusMask":
      return coerceFocusMask(id, a);
  }
}

function coerceRect(id: string, a: Record<string, unknown>): RectAnnotation {
  const hasMatch = a["match"] !== undefined;
  const hasCovers = a["coversElements"] !== undefined;
  const hasBbox = a["bbox"] !== undefined;
  requireExactlyOne(id, "rect", { match: hasMatch, coversElements: hasCovers, bbox: hasBbox });

  const out: RectAnnotation = { id, kind: "rect" };
  if (hasMatch) out.match = coerceMatchFor(id, a["match"]);
  if (hasCovers) out.coversElements = coerceMatchList(id, a["coversElements"]);
  if (hasBbox) out.bbox = coerceBbox(id, a["bbox"]);
  copyStyle(a, out);
  return out;
}

function coerceCircle(id: string, a: Record<string, unknown>): CircleAnnotation {
  const hasMatch = a["match"] !== undefined;
  const hasCenter = a["center"] !== undefined;
  requireExactlyOne(id, "circle", { match: hasMatch, center: hasCenter });

  const out: CircleAnnotation = { id, kind: "circle" };
  if (hasMatch) out.match = coerceMatchFor(id, a["match"]);
  if (hasCenter) {
    out.center = coercePoint(id, a["center"]);
    // Free-coord circles need a radius — match-anchored circles
    // can default to half the element's bbox width at render time.
    const radius = a["radius"];
    if (typeof radius !== "number" || !Number.isFinite(radius) || radius < 0) {
      throw new AnnotationsYamlError(
        `Annotation ${id}: circle with \`center\` requires a finite non-negative \`radius\``,
      );
    }
    out.radius = radius;
  } else {
    const radius = a["radius"];
    if (radius !== undefined) {
      if (typeof radius !== "number" || !Number.isFinite(radius) || radius < 0) {
        throw new AnnotationsYamlError(
          `Annotation ${id}: circle \`radius\` must be a finite non-negative number`,
        );
      }
      out.radius = radius;
    }
  }
  copyStyle(a, out);
  return out;
}

function coerceArrow(id: string, a: Record<string, unknown>): ArrowAnnotation {
  const from = coerceArrowEndpoint(id, "from", a["from"]);
  const to = coerceArrowEndpoint(id, "to", a["to"]);
  const out: ArrowAnnotation = { id, kind: "arrow", from, to };
  copyStyle(a, out);
  return out;
}

function coerceArrowEndpoint(ownerId: string, which: "from" | "to", raw: unknown): ArrowEndpoint {
  if (!raw || typeof raw !== "object") {
    throw new AnnotationsYamlError(
      `Annotation ${ownerId}: arrow.${which} must be a mapping with \`match\` or \`point\``,
    );
  }
  const r = raw as Record<string, unknown>;
  const hasMatch = r["match"] !== undefined;
  const hasPoint = r["point"] !== undefined;
  if (hasMatch === hasPoint) {
    throw new AnnotationsYamlError(
      `Annotation ${ownerId}: arrow.${which} requires exactly one of \`match\` / \`point\``,
    );
  }
  if (hasMatch) return { match: coerceMatchFor(ownerId, r["match"]) };
  return { point: coercePoint(ownerId, r["point"]) };
}

function coerceText(id: string, a: Record<string, unknown>): TextAnnotation {
  const text = a["text"];
  if (typeof text !== "string" || text.length === 0) {
    throw new AnnotationsYamlError(`Annotation ${id}: text requires a non-empty \`text\` string`);
  }
  const hasAnchor = a["anchor"] !== undefined;
  const hasAt = a["at"] !== undefined;
  requireExactlyOne(id, "text", { anchor: hasAnchor, at: hasAt });

  const out: TextAnnotation = { id, kind: "text", text };
  if (hasAnchor) {
    const anchor = a["anchor"];
    if (!anchor || typeof anchor !== "object") {
      throw new AnnotationsYamlError(`Annotation ${id}: text.anchor must be a mapping`);
    }
    const ax = anchor as Record<string, unknown>;
    const matched = coerceMatchFor(id, ax["match"]);
    const anchorOut: TextAnnotation["anchor"] = { match: matched };
    const position = ax["position"];
    if (position !== undefined) {
      if (
        typeof position !== "string" ||
        !["above", "below", "left", "right", "center"].includes(position)
      ) {
        throw new AnnotationsYamlError(
          `Annotation ${id}: text.anchor.position must be one of above / below / left / right / center`,
        );
      }
      anchorOut.position = position as TextAnchorPosition;
    }
    out.anchor = anchorOut;
  }
  if (hasAt) out.at = coercePoint(id, a["at"]);

  const fontSize = a["fontSize"];
  if (fontSize !== undefined) {
    if (typeof fontSize !== "number" || !Number.isFinite(fontSize) || fontSize <= 0) {
      throw new AnnotationsYamlError(
        `Annotation ${id}: text.fontSize must be a finite positive number`,
      );
    }
    out.fontSize = fontSize;
  }
  copyStyle(a, out);
  return out;
}

function coerceCallout(id: string, a: Record<string, unknown>): CalloutAnnotation {
  const text = a["text"];
  if (typeof text !== "string" || text.length === 0) {
    throw new AnnotationsYamlError(
      `Annotation ${id}: callout requires a non-empty \`text\` string`,
    );
  }
  const target = a["target"];
  if (!target || typeof target !== "object") {
    throw new AnnotationsYamlError(
      `Annotation ${id}: callout.target must be a mapping with \`match\` or \`bbox\``,
    );
  }
  const t = target as Record<string, unknown>;
  const hasMatch = t["match"] !== undefined;
  const hasBbox = t["bbox"] !== undefined;
  if (hasMatch === hasBbox) {
    throw new AnnotationsYamlError(
      `Annotation ${id}: callout.target requires exactly one of \`match\` / \`bbox\``,
    );
  }
  const targetResolved: CalloutTarget = hasMatch
    ? { match: coerceMatchFor(id, t["match"]) }
    : { bbox: coerceBbox(id, t["bbox"]) };

  const at = a["at"];
  if (at === undefined) {
    throw new AnnotationsYamlError(`Annotation ${id}: callout requires an \`at\` point`);
  }
  const out: CalloutAnnotation = {
    id,
    kind: "callout",
    text,
    target: targetResolved,
    at: coercePoint(id, at),
  };
  copyStyle(a, out);
  return out;
}

function coerceFreehand(id: string, a: Record<string, unknown>): FreehandAnnotation {
  const path = a["path"];
  if (typeof path !== "string" || path.length === 0) {
    throw new AnnotationsYamlError(
      `Annotation ${id}: freehand requires a non-empty \`path\` string`,
    );
  }
  const out: FreehandAnnotation = { id, kind: "freehand", path };
  copyStyle(a, out);
  return out;
}

function coerceRedact(id: string, a: Record<string, unknown>): RedactAnnotation {
  const hasMatch = a["match"] !== undefined;
  const hasBbox = a["bbox"] !== undefined;
  requireExactlyOne(id, "redact", { match: hasMatch, bbox: hasBbox });

  const out: RedactAnnotation = { id, kind: "redact" };
  if (hasMatch) out.match = coerceMatchFor(id, a["match"]);
  if (hasBbox) out.bbox = coerceBbox(id, a["bbox"]);

  const style = a["style"];
  if (style !== undefined) {
    if (style !== "solid") {
      throw new AnnotationsYamlError(
        `Annotation ${id}: redact.style must be "solid" (Phase 3 ships solid only; mosaic / blur are reserved)`,
      );
    }
    out.style = style;
  }
  copyStyle(a, out);
  return out;
}

function coerceFocusMask(id: string, a: Record<string, unknown>): FocusMaskAnnotation {
  const cutout = a["cutout"];
  if (!cutout || typeof cutout !== "object") {
    throw new AnnotationsYamlError(
      `Annotation ${id}: focusMask.cutout must be a mapping with \`match\` or \`bbox\``,
    );
  }
  const c = cutout as Record<string, unknown>;
  const hasMatch = c["match"] !== undefined;
  const hasBbox = c["bbox"] !== undefined;
  if (hasMatch === hasBbox) {
    throw new AnnotationsYamlError(
      `Annotation ${id}: focusMask.cutout requires exactly one of \`match\` / \`bbox\``,
    );
  }
  let cutoutResolved: FocusMaskCutout;
  if (hasMatch) {
    const matched = coerceMatchFor(id, c["match"]);
    const padding = c["padding"];
    if (padding !== undefined) {
      if (typeof padding !== "number" || !Number.isFinite(padding) || padding < 0) {
        throw new AnnotationsYamlError(
          `Annotation ${id}: focusMask.cutout.padding must be a finite non-negative number`,
        );
      }
      cutoutResolved = { match: matched, padding };
    } else {
      cutoutResolved = { match: matched };
    }
  } else {
    cutoutResolved = { bbox: coerceBbox(id, c["bbox"]) };
  }
  const out: FocusMaskAnnotation = { id, kind: "focusMask", cutout: cutoutResolved };
  const dimColor = a["dimColor"];
  if (dimColor !== undefined) {
    if (typeof dimColor !== "string") {
      throw new AnnotationsYamlError(`Annotation ${id}: focusMask.dimColor must be a string`);
    }
    out.dimColor = dimColor;
  }
  copyStyle(a, out);
  return out;
}

// ─── per-shape coercers' shared helpers ────────────────────────

/**
 * Wrap `coerceMatch` with an annotation-flavoured error message
 * so callers see "Annotation a1: ..." instead of "Overlay a1: ...".
 */
function coerceMatchFor(ownerId: string, raw: unknown): MatchKey {
  if (!raw || typeof raw !== "object") {
    throw new AnnotationsYamlError(`Annotation ${ownerId}: match must be a mapping`);
  }
  const m = raw as Record<string, unknown>;
  const role = m["role"];
  const name = m["name"];
  if (typeof role !== "string" || typeof name !== "string") {
    throw new AnnotationsYamlError(
      `Annotation ${ownerId}: match.role and match.name must both be strings`,
    );
  }
  const out: MatchKey = { role, name };
  if (m["under"] !== undefined) {
    out.under = coerceMatchFor(ownerId, m["under"]);
  }
  return out;
}

function coerceMatchList(ownerId: string, raw: unknown): MatchKey[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AnnotationsYamlError(
      `Annotation ${ownerId}: coversElements must be a non-empty array of match objects`,
    );
  }
  return raw.map((r) => coerceMatchFor(ownerId, r));
}

function coercePoint(ownerId: string, raw: unknown): AnnotationPoint {
  if (!raw || typeof raw !== "object") {
    throw new AnnotationsYamlError(`Annotation ${ownerId}: point must be a mapping`);
  }
  const p = raw as Record<string, unknown>;
  const x = p["x"];
  const y = p["y"];
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y)
  ) {
    throw new AnnotationsYamlError(
      `Annotation ${ownerId}: point.x and point.y must be finite numbers`,
    );
  }
  return { x, y };
}

function coerceBbox(ownerId: string, raw: unknown): AnnotationBBox {
  if (!raw || typeof raw !== "object") {
    throw new AnnotationsYamlError(`Annotation ${ownerId}: bbox must be a mapping`);
  }
  const b = raw as Record<string, unknown>;
  const x = b["x"];
  const y = b["y"];
  const width = b["width"];
  const height = b["height"];
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    width < 0 ||
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    height < 0
  ) {
    throw new AnnotationsYamlError(
      `Annotation ${ownerId}: bbox requires finite numeric x / y + non-negative width / height`,
    );
  }
  return { x, y, width, height };
}

/**
 * Enforce exactly-one-of among a set of named flags. Used by rect /
 * circle / text / redact / focusMask to keep the
 * match-vs-coversElements-vs-bbox / anchor-vs-at selector clean.
 */
function requireExactlyOne(ownerId: string, kind: string, flags: Record<string, boolean>): void {
  const set = Object.entries(flags).filter(([, v]) => v);
  if (set.length !== 1) {
    const names = Object.keys(flags).join(" / ");
    throw new AnnotationsYamlError(
      `Annotation ${ownerId}: ${kind} requires exactly one of ${names}`,
    );
  }
}

/**
 * Copy the shared `AnnotationStyleFields` from a raw mapping onto a
 * typed annotation, omitting fields whose runtime types don't match
 * the documented shape (forward-compat within v1).
 */
function copyStyle(a: Record<string, unknown>, out: AnnotationStyleFields): void {
  const intent = a["intent"];
  if (typeof intent === "string") out.intent = intent as OverlayIntent;
  const stroke = a["stroke"];
  if (typeof stroke === "string") out.stroke = stroke;
  const strokeWidth = a["strokeWidth"];
  if (typeof strokeWidth === "number" && Number.isFinite(strokeWidth) && strokeWidth >= 0) {
    out.strokeWidth = strokeWidth;
  }
  const fill = a["fill"];
  if (typeof fill === "string") out.fill = fill;
  const color = a["color"];
  if (typeof color === "string") out.color = color;
}

/**
 * Serialise an `AnnotationSpec` to the YAML-shaped JS object js-yaml
 * will dump. Key order matters for git-diff stability: `id` →
 * `kind` → variant-specific selectors → variant-specific extras →
 * style fields.
 */
function serializeAnnotation(spec: AnnotationSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { id: spec.id, kind: spec.kind };
  switch (spec.kind) {
    case "rect": {
      if (spec.match) out["match"] = serializeMatch(spec.match);
      if (spec.coversElements) {
        out["coversElements"] = spec.coversElements.map(serializeMatch);
      }
      if (spec.bbox) out["bbox"] = serializeBbox(spec.bbox);
      break;
    }
    case "circle": {
      if (spec.match) out["match"] = serializeMatch(spec.match);
      if (spec.center) out["center"] = serializePoint(spec.center);
      if (spec.radius !== undefined) out["radius"] = spec.radius;
      break;
    }
    case "arrow": {
      out["from"] = serializeArrowEndpoint(spec.from);
      out["to"] = serializeArrowEndpoint(spec.to);
      break;
    }
    case "text": {
      out["text"] = spec.text;
      if (spec.anchor) {
        const anchorOut: Record<string, unknown> = {
          match: serializeMatch(spec.anchor.match),
        };
        if (spec.anchor.position) anchorOut["position"] = spec.anchor.position;
        out["anchor"] = anchorOut;
      }
      if (spec.at) out["at"] = serializePoint(spec.at);
      if (spec.fontSize !== undefined) out["fontSize"] = spec.fontSize;
      break;
    }
    case "callout": {
      out["text"] = spec.text;
      if ("match" in spec.target) {
        out["target"] = { match: serializeMatch(spec.target.match) };
      } else {
        out["target"] = { bbox: serializeBbox(spec.target.bbox) };
      }
      out["at"] = serializePoint(spec.at);
      break;
    }
    case "freehand": {
      out["path"] = spec.path;
      break;
    }
    case "redact": {
      if (spec.match) out["match"] = serializeMatch(spec.match);
      if (spec.bbox) out["bbox"] = serializeBbox(spec.bbox);
      if (spec.style !== undefined) out["style"] = spec.style;
      break;
    }
    case "focusMask": {
      if ("match" in spec.cutout) {
        const cutoutOut: Record<string, unknown> = {
          match: serializeMatch(spec.cutout.match),
        };
        if (spec.cutout.padding !== undefined) cutoutOut["padding"] = spec.cutout.padding;
        out["cutout"] = cutoutOut;
      } else {
        out["cutout"] = { bbox: serializeBbox(spec.cutout.bbox) };
      }
      if (spec.dimColor !== undefined) out["dimColor"] = spec.dimColor;
      break;
    }
  }
  appendStyle(out, spec);
  return out;
}

function serializeArrowEndpoint(ep: ArrowEndpoint): Record<string, unknown> {
  if ("match" in ep) return { match: serializeMatch(ep.match) };
  return { point: serializePoint(ep.point) };
}

function serializeBbox(b: AnnotationBBox): Record<string, unknown> {
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

function serializePoint(p: AnnotationPoint): Record<string, unknown> {
  return { x: p.x, y: p.y };
}

function appendStyle(out: Record<string, unknown>, src: AnnotationStyleFields): void {
  if (src.intent !== undefined) out["intent"] = src.intent;
  if (src.stroke !== undefined) out["stroke"] = src.stroke;
  if (src.strokeWidth !== undefined) out["strokeWidth"] = src.strokeWidth;
  if (src.fill !== undefined) out["fill"] = src.fill;
  if (src.color !== undefined) out["color"] = src.color;
}

/**
 * In-memory validation gating `serializeAnnotationsYaml`. Mirrors
 * the parser's invariants — anything emitted here must round-trip.
 */
function validateAnnotation(spec: AnnotationSpec): void {
  if (typeof spec.id !== "string" || spec.id.length === 0) {
    throw new AnnotationsYamlError(`Annotation entry missing id: ${JSON.stringify(spec)}`);
  }
  if (!ANNOTATION_KINDS.includes(spec.kind)) {
    throw new AnnotationsYamlError(
      `Annotation ${spec.id}: unknown kind ${JSON.stringify(spec.kind)}`,
    );
  }
  switch (spec.kind) {
    case "rect": {
      const set = [
        spec.match !== undefined,
        spec.coversElements !== undefined,
        spec.bbox !== undefined,
      ].filter(Boolean);
      if (set.length !== 1) {
        throw new AnnotationsYamlError(
          `Annotation ${spec.id}: rect requires exactly one of match / coversElements / bbox`,
        );
      }
      if (spec.coversElements && spec.coversElements.length === 0) {
        throw new AnnotationsYamlError(
          `Annotation ${spec.id}: rect.coversElements must be non-empty`,
        );
      }
      break;
    }
    case "circle": {
      const set = [spec.match !== undefined, spec.center !== undefined].filter(Boolean);
      if (set.length !== 1) {
        throw new AnnotationsYamlError(
          `Annotation ${spec.id}: circle requires exactly one of match / center`,
        );
      }
      if (
        spec.center &&
        (spec.radius === undefined || !Number.isFinite(spec.radius) || spec.radius < 0)
      ) {
        throw new AnnotationsYamlError(
          `Annotation ${spec.id}: circle with center requires a finite non-negative radius`,
        );
      }
      break;
    }
    case "arrow": {
      if (!spec.from || !spec.to) {
        throw new AnnotationsYamlError(`Annotation ${spec.id}: arrow requires both from + to`);
      }
      break;
    }
    case "text": {
      if (typeof spec.text !== "string" || spec.text.length === 0) {
        throw new AnnotationsYamlError(`Annotation ${spec.id}: text requires non-empty \`text\``);
      }
      const set = [spec.anchor !== undefined, spec.at !== undefined].filter(Boolean);
      if (set.length !== 1) {
        throw new AnnotationsYamlError(
          `Annotation ${spec.id}: text requires exactly one of anchor / at`,
        );
      }
      break;
    }
    case "callout": {
      if (typeof spec.text !== "string" || spec.text.length === 0) {
        throw new AnnotationsYamlError(
          `Annotation ${spec.id}: callout requires non-empty \`text\``,
        );
      }
      if (!spec.target || !spec.at) {
        throw new AnnotationsYamlError(`Annotation ${spec.id}: callout requires target + at`);
      }
      break;
    }
    case "freehand": {
      if (typeof spec.path !== "string" || spec.path.length === 0) {
        throw new AnnotationsYamlError(
          `Annotation ${spec.id}: freehand requires non-empty \`path\``,
        );
      }
      break;
    }
    case "redact": {
      const set = [spec.match !== undefined, spec.bbox !== undefined].filter(Boolean);
      if (set.length !== 1) {
        throw new AnnotationsYamlError(
          `Annotation ${spec.id}: redact requires exactly one of match / bbox`,
        );
      }
      if (spec.style !== undefined && spec.style !== "solid") {
        throw new AnnotationsYamlError(
          `Annotation ${spec.id}: redact.style must be "solid" (Phase 3 ships solid only)`,
        );
      }
      break;
    }
    case "focusMask": {
      if (!spec.cutout) {
        throw new AnnotationsYamlError(`Annotation ${spec.id}: focusMask requires cutout`);
      }
      break;
    }
  }
}
