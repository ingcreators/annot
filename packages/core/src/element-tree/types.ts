// ElementTree — canonical "what's on this page" model.
//
// Phase 1a of `docs/plans/living-spec-authoring-roadmap.md`. Single
// source-agnostic representation replacing two parallel paths kept
// apart by implementation accident:
//
//   - Browser extension's flat `PageMetadata` / `PageElement[]`
//     produced by the MAIN-world DOM walker (see
//     `packages/capture/src/content/page-metadata-walker.ts`).
//   - Playwright's `ariaSnapshot({ mode: "ai", boxes: true })` YAML
//     parsed into a flat `SnapshotEntry[]` with parent-chain
//     reconstruction (see `parseSnapshot` in
//     `@ingcreators/annot-product-docs/resolver.ts`).
//
// ElementTree is a **proper tree** (matches the DOM mental model),
// carries per-node attributes inline (eliminates the sibling
// `annot:attributes` YAML), and uses a single `ref: "e<n>"` format
// stable WITHIN one capture only (cross-capture identity is the
// annotation layer's `match: { role, name }` job — see AD-09 + OQ-11).
//
// Pure Tier A — no DOM access, no Node-specific APIs. Importable
// under pure Node, jsdom, browser, or any other environment.

/**
 * Top-level ElementTree wire format. Stored in PNG XMP as iTXt
 * (`annot:elementTree` keyword, deflate-compressed YAML by default —
 * see `@ingcreators/annot-core/xmp` extension landed in Phase 1d).
 */
export interface ElementTree {
  /** Schema version. Currently 1. Reader version-dispatches; writers
   *  always emit the current schema. */
  version: 1;
  /** Metadata about who produced this capture. */
  source: ElementTreeSource;
  /** Capture viewport. CSS px; `scale` is the device-pixel-ratio. */
  viewport: ElementTreeViewport;
  /** Root node. Always present. Often `role: "main"` or `"document"`
   *  for browser captures; for partial captures (area / element-scoped)
   *  the root is the captured element itself. */
  root: ElementNode;
}

export interface ElementTreeSource {
  /** Which capture tool produced this tree. Common values:
   *  `"extension"` (browser extension MAIN-world walker),
   *  `"playwright"` (ariaSnapshot adapter). Open-ended so future
   *  Figma / screen-recorder / OCR adapters slot in cleanly. */
  kind: "extension" | "playwright" | (string & {});
  /** ISO 8601 timestamp of when the tree was produced. */
  capturedAt: string;
  /** Optional human-readable tool identifier (e.g.
   *  `"annot-playwright@0.4.0"`). Used in `annot show-xmp` output for
   *  debug; not consumed programmatically. */
  agent?: string;
  /** Source page URL at capture time, if applicable. */
  url?: string;
}

export interface ElementTreeViewport {
  /** Viewport width in CSS px. */
  width: number;
  /** Viewport height in CSS px. */
  height: number;
  /** `window.devicePixelRatio` (or equivalent) at capture time. Used
   *  to map CSS-px bboxes onto device-px screenshot coordinates. */
  scale: number;
}

/**
 * Per-node payload. Children are nested in `children`; the tree is
 * walked depth-first.
 */
export interface ElementNode {
  /** ARIA role. Always present — decorative nodes use `"generic"` or
   *  `"presentation"`. Browser captures fall back to the implicit
   *  role for the underlying tag when ARIA doesn't apply. */
  role: string;
  /** Accessible name. Omitted when empty. */
  name?: string;
  /** Page-space bounding box in CSS px. Omitted for hidden / abstract
   *  nodes (e.g. document root with no measurable extent). */
  bbox?: BBox;
  /** Tree-unique identifier in `e<n>` format (depth-first numbering
   *  starting at `e1`). Stable WITHIN one capture; NOT stable across
   *  re-captures — see OQ-11 in the roadmap. */
  ref: string;
  /** ARIA-derived state tokens. Single tokens like `"checked"`,
   *  `"pressed"`, `"expanded"`, `"selected"`, `"disabled"`,
   *  `"required"`, `"invalid"`. Also accepts `key=value` tokens for
   *  scalar states: `"level=2"`, `"valuetext=10"`. */
  states?: readonly string[];
  /** HTML attribute snapshot (whitelist-filtered at capture time).
   *  Keys are lowercase attribute names; values are the attribute
   *  strings. Empty when no attributes were captured. */
  attributes?: Readonly<Record<string, string>>;
  /** Direct text content (heading body, paragraph text, textbox
   *  value). Distinct from `name` for elements where they differ
   *  (e.g. a textbox with placeholder `"Email"` and current value
   *  `"alice@example.com"` has `name: "Email"`, `text:
   *  "alice@example.com"`). */
  text?: string;
  /** Children in document order. Omitted for leaf nodes. */
  children?: readonly ElementNode[];
}

/**
 * Axis-aligned bounding box. CSS px, page-space coordinates.
 */
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convenience type guard for callers that receive `unknown` payloads
 * and need to check whether they look like an ElementTree before
 * narrowing. Light validation only — checks for the presence of the
 * three required top-level keys plus `version === 1`. The full
 * parsers (`parseElementTreeFromYaml` / `parseElementTreeFromJson`)
 * do exhaustive structural validation.
 */
export function isElementTreeShape(value: unknown): value is ElementTree {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (typeof v.source !== "object" || v.source === null) return false;
  if (typeof v.viewport !== "object" || v.viewport === null) return false;
  if (typeof v.root !== "object" || v.root === null) return false;
  return true;
}
