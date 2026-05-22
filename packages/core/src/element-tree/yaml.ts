// ElementTree YAML serializer + parser.
//
// Phase 1a of `docs/plans/living-spec-authoring-roadmap.md`. YAML is
// the canonical wire format for `annot:elementTree` PNG XMP payloads
// — see OQ-10 for the YAML-vs-JSON decision. The JSON form lives in
// `./json.ts` for callers that prefer it.
//
// Pure Tier A — `js-yaml` is pure JavaScript with no DOM dependency.

import { dump as yamlDump, load as yamlLoad } from "js-yaml";
import { validateElementTree } from "./json.js";
import type { ElementNode, ElementTree, ElementTreeSource, ElementTreeViewport } from "./types.js";

/**
 * Serialize an ElementTree to YAML.
 *
 * The output uses 2-space indent, sorted top-level keys, and
 * deterministic field ordering inside each node so the same tree
 * always serializes to byte-identical YAML. This is important for
 * the XMP write path — re-saving a PNG without semantic changes
 * must produce identical bytes, otherwise git history thrashes
 * pointlessly.
 *
 * Empty optional fields (`states`, `attributes`, `children`) are
 * omitted entirely. The reader treats absence and empty as
 * equivalent.
 */
export function serializeElementTreeToYaml(tree: ElementTree): string {
  const normalized = normalizeTree(tree);
  return yamlDump(normalized, {
    indent: 2,
    lineWidth: -1, // never wrap long strings
    noRefs: true, // never emit `*ref` anchors (we use plain values)
    sortKeys: false, // we already enforce field order via normalizeTree
    quotingType: '"', // double-quote strings consistently
    forceQuotes: false,
  });
}

/**
 * Parse a YAML string into an ElementTree. Throws `Error` with a
 * descriptive message on malformed input (parse failure or schema
 * mismatch).
 */
export function parseElementTreeFromYaml(yaml: string): ElementTree {
  let raw: unknown;
  try {
    raw = yamlLoad(yaml);
  } catch (err) {
    throw new Error(
      `ElementTree YAML parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return validateElementTree(raw);
}

// ─── Deterministic field ordering ───────────────────────────────────
// `js-yaml` preserves insertion order of object keys, so we build new
// objects with the desired key order and `js-yaml` reproduces that
// order in the output. The order chosen here is: stable identifiers
// first (`version`, `ref`), then descriptive metadata (`role`,
// `name`, `text`), then geometry (`bbox`), then attributes / states,
// then children last (so each node's identity is visible before its
// subtree).

function normalizeTree(tree: ElementTree): Record<string, unknown> {
  return {
    version: tree.version,
    source: normalizeSource(tree.source),
    viewport: normalizeViewport(tree.viewport),
    root: normalizeNode(tree.root),
  };
}

function normalizeSource(source: ElementTreeSource): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: source.kind };
  if (source.url !== undefined) out.url = source.url;
  if (source.agent !== undefined) out.agent = source.agent;
  out.capturedAt = source.capturedAt;
  return out;
}

function normalizeViewport(viewport: ElementTreeViewport): Record<string, unknown> {
  return {
    width: viewport.width,
    height: viewport.height,
    scale: viewport.scale,
  };
}

function normalizeNode(node: ElementNode): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ref: node.ref,
    role: node.role,
  };
  if (node.name !== undefined) out.name = node.name;
  if (node.text !== undefined) out.text = node.text;
  if (node.bbox !== undefined) {
    out.bbox = {
      x: node.bbox.x,
      y: node.bbox.y,
      width: node.bbox.width,
      height: node.bbox.height,
    };
  }
  if (node.states !== undefined && node.states.length > 0) {
    out.states = [...node.states];
  }
  if (node.attributes !== undefined) {
    const keys = Object.keys(node.attributes);
    if (keys.length > 0) {
      // Sort attribute keys for stable output regardless of insertion order.
      const sortedAttrs: Record<string, string> = {};
      for (const key of [...keys].sort()) {
        sortedAttrs[key] = node.attributes[key]!;
      }
      out.attributes = sortedAttrs;
    }
  }
  if (node.children !== undefined && node.children.length > 0) {
    out.children = node.children.map(normalizeNode);
  }
  return out;
}
