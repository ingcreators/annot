/**
 * Annotation yaml — Tier A data model for the `.annotations.yaml`
 * files Phase 2 of
 * [`docs/plans/living-spec-authoring-roadmap.md`](../../../docs/plans/living-spec-authoring-roadmap.md)
 * extracts from the legacy inline `<Overlay>` JSX.
 *
 * Wire format (Phase 2 scope — `overlays[]` only; Phase 3 will add
 * `annotations[]` for the full annotation palette):
 *
 * ```yaml
 * version: 1
 * overlays:
 *   - id: o1
 *     kind: numberedBadge
 *     match: { role: "textbox", name: "Email" }
 *     intent: required
 *     number: 1
 *   - id: o2
 *     kind: numberedBadge
 *     match:
 *       role: "textbox"
 *       name: "Sign in"
 *       under: { role: "form", name: "Sign in" }
 *     number: 2
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
 * Top-level wire shape for an `.annotations.yaml` file. Phase 2
 * exposes `overlays[]` only; Phase 3 of the roadmap extends this
 * with a sibling `annotations[]` array carrying the full palette.
 *
 * `meta` is an open string map reserved for downstream tooling
 * (book grouping, generator IDs, etc.) — readers must ignore
 * unknown keys.
 */
export interface AnnotationsFile {
  version: typeof ANNOTATIONS_YAML_VERSION;
  overlays: OverlayEntry[];
  /** Optional free-form metadata. Readers ignore unknown keys. */
  meta?: Record<string, string>;
}

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
  const payload: Record<string, unknown> = {
    version: file.version,
    overlays: file.overlays.map(serializeOverlay),
  };
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
