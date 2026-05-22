/**
 * Helpers for the tree-view variant of the page-elements section
 * — Phase 1f of `docs/plans/living-spec-authoring-roadmap.md`.
 * These mirror `element-helpers.ts` but accept the canonical
 * `ElementNode` (from `@ingcreators/annot-core/element-tree`)
 * instead of the legacy flat `PageElement`. The two helper sets
 * coexist during the migration; Phase 1i removes the legacy ones.
 */

import type { ElementNode } from "@ingcreators/annot-core";

/** Material Symbols glyph name appropriate to the node's role. */
export function iconForElementNode(node: ElementNode): string {
  switch (node.role) {
    case "button":
      return "smart_button";
    case "link":
      return "link";
    case "textbox":
    case "searchbox":
      return "edit";
    case "checkbox":
      return "check_box";
    case "radio":
      return "radio_button_checked";
    case "tab":
      return "tab";
    case "menuitem":
      return "more_vert";
    case "slider":
      return "tune";
    case "heading":
      return "title";
    case "combobox":
      return "list";
    case "main":
    case "document":
      return "view_quilt";
    case "form":
      return "list_alt";
    case "navigation":
      return "menu";
    case "banner":
      return "view_carousel";
    case "complementary":
      return "view_sidebar";
    case "contentinfo":
      return "info";
    default:
      return "widgets";
  }
}

/** Primary text shown on a tree row — first non-empty of: name,
 *  text, ref. Trimmed for compactness. */
export function primaryLabelForNode(node: ElementNode): string {
  const candidate = node.name || node.text || node.ref;
  if (!candidate) return node.role;
  return candidate.length > 36 ? `${candidate.slice(0, 33)}…` : candidate;
}

/** Sub-label (small grey text on the right) — role hint + optional
 *  child count for branches. */
export function subLabelForNode(node: ElementNode): string {
  const childCount = node.children?.length ?? 0;
  if (childCount > 0) return `${node.role} · ${childCount}`;
  return node.role;
}

/** Tooltip — name + role + key states + key attributes. */
export function fullDescriptionForNode(node: ElementNode): string {
  const parts: string[] = [];
  if (node.name) parts.push(node.name);
  parts.push(`<role=${node.role}>`);
  if (node.states && node.states.length > 0) {
    parts.push(`[${node.states.join(", ")}]`);
  }
  if (node.attributes?.href) parts.push(`→ ${node.attributes.href}`);
  return parts.join("\n");
}

/** Walk a node + its descendants, returning a flat list with depth
 *  + ancestor-chain-of-refs for each entry. Used by the section to
 *  render the tree as a series of indented rows + maintain a
 *  per-row expand/collapse state keyed by ref path. */
export interface FlatTreeRow {
  node: ElementNode;
  depth: number;
  /** Refs of every ancestor from root down to (but excluding) this
   *  node. Used as a stable, unique key for per-row UI state. */
  parentRefs: readonly string[];
}

export function flattenForTreeRender(root: ElementNode): FlatTreeRow[] {
  const out: FlatTreeRow[] = [];
  function visit(node: ElementNode, depth: number, parentRefs: readonly string[]): void {
    out.push({ node, depth, parentRefs });
    if (!node.children) return;
    const nextParents = [...parentRefs, node.ref];
    for (const child of node.children) {
      visit(child, depth + 1, nextParents);
    }
  }
  visit(root, 0, []);
  return out;
}
