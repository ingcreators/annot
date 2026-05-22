// ElementTree JSON serializer + parser.
//
// Phase 1a of `docs/plans/living-spec-authoring-roadmap.md`. The
// JSON form is for callers that prefer JSON over YAML — MCP tool
// payloads, AI agent prompts, in-memory snapshotting. YAML is the
// canonical wire format (see OQ-10 + `./yaml.ts`).
//
// Pure Tier A — no DOM, no dependencies beyond `JSON.stringify` /
// `JSON.parse`.

import { type ElementNode, type ElementTree, isElementTreeShape } from "./types.js";

/**
 * Serialize an ElementTree to a JSON string. Uses 2-space indent for
 * readability; pass `compact: true` for a single-line minified
 * form. Optional / undefined fields are omitted from the output to
 * keep the serialization round-trip stable.
 */
export function serializeElementTreeToJson(
  tree: ElementTree,
  options: { compact?: boolean } = {},
): string {
  const indent = options.compact ? undefined : 2;
  return JSON.stringify(tree, jsonReplacer, indent);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  // `JSON.stringify` already drops `undefined` values from object
  // outputs, but doesn't drop empty arrays / empty objects. Keep the
  // serialization stable by omitting empty `children`, empty
  // `states`, and empty `attributes` — the readers default these to
  // undefined anyway, so emitting `[]` / `{}` would round-trip to
  // `undefined`, breaking byte-equivalence.
  if (Array.isArray(value) && value.length === 0) return undefined;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0
  ) {
    return undefined;
  }
  return value;
}

/**
 * Parse a JSON string into an ElementTree. Throws `Error` with a
 * descriptive message on malformed input — the parser is strict to
 * surface schema drift early.
 */
export function parseElementTreeFromJson(json: string): ElementTree {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `ElementTree JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return validateElementTree(raw);
}

/**
 * Strict structural validation of a parsed `unknown` payload.
 * Exported so the YAML parser can share the same validation pass.
 */
export function validateElementTree(value: unknown): ElementTree {
  if (!isElementTreeShape(value)) {
    throw new Error(
      "ElementTree payload missing required top-level keys (version, source, viewport, root)",
    );
  }
  const tree = value as ElementTree;
  validateSource(tree.source);
  validateViewport(tree.viewport);
  validateNode(tree.root, "root");
  return tree;
}

function validateSource(source: ElementTree["source"]): void {
  if (typeof source.kind !== "string" || source.kind.length === 0) {
    throw new Error("ElementTree.source.kind must be a non-empty string");
  }
  if (typeof source.capturedAt !== "string" || source.capturedAt.length === 0) {
    throw new Error("ElementTree.source.capturedAt must be a non-empty ISO 8601 string");
  }
  if (source.agent !== undefined && typeof source.agent !== "string") {
    throw new Error("ElementTree.source.agent, when present, must be a string");
  }
  if (source.url !== undefined && typeof source.url !== "string") {
    throw new Error("ElementTree.source.url, when present, must be a string");
  }
}

function validateViewport(viewport: ElementTree["viewport"]): void {
  if (typeof viewport.width !== "number" || !Number.isFinite(viewport.width)) {
    throw new Error("ElementTree.viewport.width must be a finite number");
  }
  if (typeof viewport.height !== "number" || !Number.isFinite(viewport.height)) {
    throw new Error("ElementTree.viewport.height must be a finite number");
  }
  if (typeof viewport.scale !== "number" || !Number.isFinite(viewport.scale)) {
    throw new Error("ElementTree.viewport.scale must be a finite number");
  }
}

function validateNode(node: unknown, path: string): asserts node is ElementNode {
  if (typeof node !== "object" || node === null) {
    throw new Error(`ElementTree node at ${path} is not an object`);
  }
  const n = node as Record<string, unknown>;
  if (typeof n.role !== "string" || n.role.length === 0) {
    throw new Error(`ElementTree node at ${path} missing required role`);
  }
  if (typeof n.ref !== "string" || !/^e\d+$/.test(n.ref)) {
    throw new Error(`ElementTree node at ${path} has invalid ref (expected "e<n>")`);
  }
  if (n.name !== undefined && typeof n.name !== "string") {
    throw new Error(`ElementTree node at ${path} has non-string name`);
  }
  if (n.text !== undefined && typeof n.text !== "string") {
    throw new Error(`ElementTree node at ${path} has non-string text`);
  }
  if (n.bbox !== undefined) {
    const b = n.bbox as Record<string, unknown>;
    for (const key of ["x", "y", "width", "height"] as const) {
      if (typeof b[key] !== "number" || !Number.isFinite(b[key] as number)) {
        throw new Error(`ElementTree node at ${path} bbox.${key} must be a finite number`);
      }
    }
  }
  if (n.states !== undefined) {
    if (!Array.isArray(n.states)) {
      throw new Error(`ElementTree node at ${path} states must be an array`);
    }
    for (const [i, s] of n.states.entries()) {
      if (typeof s !== "string") {
        throw new Error(`ElementTree node at ${path} states[${i}] must be a string`);
      }
    }
  }
  if (n.attributes !== undefined) {
    if (typeof n.attributes !== "object" || n.attributes === null) {
      throw new Error(`ElementTree node at ${path} attributes must be an object`);
    }
    for (const [k, v] of Object.entries(n.attributes)) {
      if (typeof v !== "string") {
        throw new Error(
          `ElementTree node at ${path} attributes[${k}] must be a string (got ${typeof v})`,
        );
      }
    }
  }
  if (n.children !== undefined) {
    if (!Array.isArray(n.children)) {
      throw new Error(`ElementTree node at ${path} children must be an array`);
    }
    for (const [i, child] of n.children.entries()) {
      validateNode(child, `${path}.children[${i}]`);
    }
  }
}
