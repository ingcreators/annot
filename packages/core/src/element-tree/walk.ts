// ElementTree walk / find / flatten utilities.
//
// Phase 1a of `docs/plans/living-spec-authoring-roadmap.md`.
// Pure traversal helpers for `ElementTree`. No DOM, no I/O —
// importable from any tier.

import type { ElementNode, ElementTree } from "./types.js";

/**
 * Visitor callback. Return `false` to stop traversal early; return
 * `void` / `true` to keep walking. The `parents` array gives the
 * ancestor chain from the root down to (but excluding) the visited
 * node — empty for the root itself.
 */
export type ElementTreeVisitor = (
  node: ElementNode,
  parents: readonly ElementNode[],
) => boolean | void;

/**
 * Depth-first walk over every node in the tree. Stops early when the
 * visitor returns `false`.
 */
export function walkTree(tree: ElementTree, visit: ElementTreeVisitor): void {
  walkNode(tree.root, [], visit);
}

function walkNode(
  node: ElementNode,
  parents: readonly ElementNode[],
  visit: ElementTreeVisitor,
): boolean {
  const cont = visit(node, parents);
  if (cont === false) return false;
  if (!node.children) return true;
  const nextParents = [...parents, node];
  for (const child of node.children) {
    if (!walkNode(child, nextParents, visit)) return false;
  }
  return true;
}

/**
 * Find the unique node with the given `ref`, or `null` if none.
 * Refs are tree-unique within one capture (depth-first numbering),
 * so the first match is the only match.
 */
export function findByRef(tree: ElementTree, ref: string): ElementNode | null {
  let found: ElementNode | null = null;
  walkTree(tree, (node) => {
    if (node.ref === ref) {
      found = node;
      return false;
    }
  });
  return found;
}

/**
 * Match descriptor used by annotation yaml's `match: { role, name }`
 * resolver. Both fields optional independently — a `{ role: "main" }`
 * match catches every node with that role regardless of name; a
 * `{ name: "Sign in" }` catches every node with that name regardless
 * of role. When both are set, both must match (AND semantics). `name`
 * comparison is exact.
 */
export interface ElementMatch {
  role?: string;
  name?: string;
}

/**
 * Find every node satisfying the match. Returns nodes in
 * depth-first document order.
 *
 * Returning all matches (not just the first) lets callers detect
 * ambiguity — drift detection flags `duplicated` when a unique
 * `match` resolves to more than one node.
 */
export function findByMatch(tree: ElementTree, match: ElementMatch): ElementNode[] {
  const out: ElementNode[] = [];
  if (!match.role && !match.name) return out;
  walkTree(tree, (node) => {
    if (match.role !== undefined && node.role !== match.role) return;
    if (match.name !== undefined && node.name !== match.name) return;
    out.push(node);
  });
  return out;
}

/**
 * Produce a flat array of every node in depth-first document order.
 * Each entry is the live `ElementNode` reference (no copying); the
 * caller must treat the result as read-only.
 *
 * Useful for consumers that prefer flat iteration (legacy
 * `PageElement[]`-shaped consumers during migration, search index
 * builders, etc.). Prefer `walkTree` when ancestor context matters.
 */
export function flattenTree(tree: ElementTree): ElementNode[] {
  const out: ElementNode[] = [];
  walkTree(tree, (node) => {
    out.push(node);
  });
  return out;
}
