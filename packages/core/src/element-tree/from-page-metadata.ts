// Adapter — legacy `PageMetadata` (flat list, browser extension)
// → canonical `ElementTree`.
//
// Phase 1e of `docs/plans/living-spec-authoring-roadmap.md`. Lets
// the extension capture path persist its existing `PageMetadata`
// captures into the new `annot:elementTree` PNG XMP slot without
// requiring the MAIN-world walker rewrite from 1c to be wired into
// orchestrators yet.
//
// **Best-effort lossy conversion.** PageMetadata is a flat list
// with no DOM hierarchy information, so the produced tree has the
// captureRect as the root and every element as a direct child.
// This is structurally compatible with the canonical
// `ElementTree` schema (single root, depth-first refs) but loses
// the per-DOM-subtree nesting the 1c walker reconstructs. When a
// caller needs the hierarchical form, prefer the 1c walker.
//
// Pure Tier A — no DOM, no Node-only APIs.

import type { BBox, ElementNode, ElementTree } from "./types.js";

/**
 * Subset of the legacy `PageMetadata` shape needed for conversion.
 * Structurally compatible with `@ingcreators/annot-core/storage`'s
 * `PageMetadata`; declared inline here to keep this module free of
 * the storage import (which carries deeper transitive types).
 */
export interface LegacyPageMetadataLike {
  url: string;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  scrollOffset: { x: number; y: number };
  captureRect: { x: number; y: number; width: number; height: number };
  capturedAt: string;
  elements: readonly LegacyPageElementLike[];
}

export interface LegacyPageElementLike {
  id: string;
  tag: string;
  role?: string;
  text?: string;
  ariaLabel?: string;
  inputType?: string;
  placeholder?: string;
  href?: string;
  domId?: string;
  bbox: readonly [number, number, number, number];
  selector?: string;
}

/**
 * Convert a legacy `PageMetadata` snapshot to an `ElementTree`.
 *
 * Mapping rules:
 *
 * - `version` → `version: 1`
 * - `url` / `viewport` / `devicePixelRatio` / `capturedAt` →
 *   `source` / `viewport` fields
 * - `elements[]` → root.children (single-level nesting since
 *   PageMetadata has no parent indices to rebuild a true tree)
 * - per element:
 *   - `role` (explicit or implicit per legacy walker) → `role`,
 *     fallback `"generic"` when absent
 *   - `text` / `ariaLabel` collapsed into `name` (ariaLabel wins
 *     when both present — matches the legacy reader's policy)
 *   - `bbox` array → `bbox` object
 *   - `id` (already in `e<n>` shape from the legacy walker) → `ref`,
 *     numbered freshly from `e1` if the legacy id is not in that
 *     shape
 *   - `inputType` / `placeholder` / `href` / `domId` → `attributes`
 *     entries (whitelist-filtered names match the 1c walker's
 *     attribute namespace)
 */
export function pageMetadataToElementTree(pm: LegacyPageMetadataLike): ElementTree {
  let refCounter = 0;
  const nextRef = (): string => {
    refCounter++;
    return `e${refCounter}`;
  };

  function legacyRef(id: string): string {
    return /^e\d+$/.test(id) ? id : nextRef();
  }

  const children: ElementNode[] = pm.elements.map((el) => {
    const name = el.ariaLabel ?? el.text;
    const attributes: Record<string, string> = {};
    if (el.domId) attributes.id = el.domId;
    if (el.href) attributes.href = el.href;
    if (el.inputType) attributes.type = el.inputType;
    if (el.placeholder) attributes.placeholder = el.placeholder;

    const bbox: BBox = {
      x: el.bbox[0],
      y: el.bbox[1],
      width: el.bbox[2],
      height: el.bbox[3],
    };
    const node: ElementNode = {
      ref: legacyRef(el.id),
      role: el.role ?? "generic",
      bbox,
    };
    if (name !== undefined && name.length > 0) {
      (node as { name: string }).name = name;
    }
    if (Object.keys(attributes).length > 0) {
      (node as { attributes: Record<string, string> }).attributes = attributes;
    }
    return node;
  });

  return {
    version: 1,
    source: {
      kind: "extension",
      capturedAt: pm.capturedAt,
      agent: "annot-extension-page-metadata@1",
      url: pm.url,
    },
    viewport: {
      width: pm.viewport.width,
      height: pm.viewport.height,
      scale: pm.devicePixelRatio,
    },
    root: {
      ref: "e0",
      role: "document",
      bbox: { ...pm.captureRect },
      ...(children.length > 0 ? { children } : {}),
    },
  };
}
