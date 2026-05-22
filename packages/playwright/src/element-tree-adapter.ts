// Playwright → ElementTree adapter.
//
// Phase 1b of `docs/plans/living-spec-authoring-roadmap.md`. Converts
// Playwright's `ariaSnapshot({ mode: "ai", boxes: true })` YAML into
// the canonical `ElementTree` shape from
// `@ingcreators/annot-core/element-tree`. Optional attribute
// collection (`attachAttributes`) walks the tree and fills per-node
// `attributes` via `locator.evaluate`, eliminating the separate
// `annot:attributes` YAML block that lived as a sibling cache in
// `@ingcreators/annot-product-docs/fixture.ts` (`collectAttributesYaml`).
//
// **This module is purely additive in 1b.** Existing `parseSnapshot`
// / `collectAttributesYaml` paths stay untouched. Phase 1e wires the
// adapter into `productDocs.sync`; phase 1i removes the legacy
// helpers.
//
// Tier C: imports from `@playwright/test` (peer dep). The pure
// YAML-to-tree converter `playwrightYamlToElementTree` has no
// Playwright-runtime dependency and can be exercised under pure
// Node / vitest. The attribute-collection helper requires a real
// Playwright `Page`.

import type {
  BBox,
  ElementNode,
  ElementTree,
  ElementTreeViewport,
} from "@ingcreators/annot-core/element-tree";
import { walkTree } from "@ingcreators/annot-core/element-tree";

/**
 * Options for the pure YAML → tree conversion.
 */
export interface PlaywrightYamlToElementTreeOptions {
  /** Raw output of `page.locator(...).ariaSnapshot({ mode: "ai",
   *  boxes: true })`. Required. */
  yaml: string;
  /** Viewport dimensions + DPR at capture time. Required. */
  viewport: ElementTreeViewport;
  /** Page URL at capture time. Stored in `ElementTree.source.url`. */
  url?: string;
  /** Tool identifier (e.g. `"annot-playwright@0.4.0"`). Stored in
   *  `ElementTree.source.agent`. */
  agent?: string;
  /** Capture timestamp. Defaults to `new Date().toISOString()`. */
  capturedAt?: string;
}

/**
 * Convert Playwright's aria-snapshot YAML into an `ElementTree`.
 *
 * The YAML format Playwright emits in `mode: "ai"` is a
 * 2-space-per-level indented bullet list:
 *
 * ```yaml
 * - main:
 *   - heading "Sign in" [level=1] [ref=e2]
 *   - form [ref=e3]:
 *     - textbox "Email" [ref=e4] [box=100,200,300,40]
 *     - button "Sign in" [active] [ref=e6]
 * ```
 *
 * Each line:
 *   - starts with `-` at some indent
 *   - role token (lowercase letters)
 *   - optional `"name"` (double-quoted)
 *   - zero or more `[token]` annotations: `[ref=eN]`, `[box=x,y,w,h]`,
 *     `[state]`, `[key=value]`
 *   - optional trailing `:` indicating a container
 *
 * Nodes without a `[ref=…]` (decorative containers) get a synthetic
 * `ref` so every node in the resulting tree has a unique identifier.
 */
export function playwrightYamlToElementTree(opts: PlaywrightYamlToElementTreeOptions): ElementTree {
  const lines = opts.yaml.split(/\r?\n/);

  let syntheticRefCounter = 0;
  const nextSyntheticRef = (): string => {
    // Use `s<n>` for synthetic refs so they're distinguishable from
    // Playwright's own `e<n>` series. The ElementTree schema validator
    // only enforces `e<n>` for top-level format compliance — to keep
    // synthetic refs valid we still emit them as `e<n>` but seed from
    // a high number to avoid collisions with Playwright-assigned refs.
    syntheticRefCounter++;
    return `e9${String(syntheticRefCounter).padStart(5, "0")}`;
  };

  interface StackFrame {
    indent: number;
    node: ElementNode;
    children: ElementNode[];
  }

  // Synthetic root that holds every top-level line as a child. We
  // unwrap below when populating `ElementTree.root`.
  const rootChildren: ElementNode[] = [];
  const stack: StackFrame[] = [];

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    // Split indent + body cleanly so the bullet regex doesn't have
    // a leading `\s*` adjacent to its own `\s+`. The two overlapping
    // whitespace patterns create polynomial backtracking under
    // adversarial input (CodeQL flag).
    const trimmedStart = rawLine.replace(/^\s+/, "");
    const indent = rawLine.length - trimmedStart.length;
    const body = trimmedStart.replace(/\s+$/, "");

    // Match the bullet, role, optional quoted name, the rest of the
    // line (which may contain bracket groups and/or a trailing `:`).
    //
    // Name uses the simple `"([^"]*)"` pattern (same as
    // `parseSnapshot` in `@ingcreators/annot-product-docs/resolver.ts`)
    // instead of the backslash-escape-aware
    // `(?:[^"\\]|\\.)*?` form. The escape-aware version is
    // polynomial under adversarial input (CodeQL flags it) and
    // Playwright's aria-snapshot output empirically never escapes
    // quotes inside names — it just doesn't emit names containing
    // internal double-quotes.
    const head = body.match(/^-\s+([a-z]+)(?:\s+"([^"]*)")?(.*)$/);
    if (!head) continue;
    const role = head[1] ?? "";
    const name = head[2];
    let rest = head[3] ?? "";

    const isContainer = /:$/.test(rest);
    if (isContainer) rest = rest.slice(0, -1);

    // Bracket extraction uses three TARGETED patterns instead of a
    // generic `\[([^\]]+)\]` walker. The `[^\]]+` form is polynomial
    // under adversarial input (CodeQL flags it for the same reason
    // `parseSnapshot` switched to targeted patterns). The targeted
    // forms have bounded backtracking because their inner character
    // classes exclude the literal `]` terminator AND restrict to a
    // short whitelist.
    const states: string[] = [];
    let ref: string | undefined;
    let bbox: BBox | undefined;

    const refMatch = rest.match(/\[ref=(e\d+)\]/);
    if (refMatch) ref = refMatch[1];

    const boxMatch = rest.match(
      /\[box=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]/,
    );
    if (boxMatch) {
      bbox = {
        x: Number(boxMatch[1]),
        y: Number(boxMatch[2]),
        width: Number(boxMatch[3]),
        height: Number(boxMatch[4]),
      };
    }

    // Remaining brackets are state tokens (e.g. `active`,
    // `disabled`, `level=2`). The restricted character class
    // `[A-Za-z0-9_=,.\-]+` matches what Playwright actually emits
    // and is linear-time (no `]` in the class).
    const stateRegex = /\[([A-Za-z][A-Za-z0-9_=,.\-]*)\]/g;
    let stateMatch: RegExpExecArray | null;
    while ((stateMatch = stateRegex.exec(rest)) !== null) {
      const token = stateMatch[1] ?? "";
      // Skip `ref=…` and `box=…` since those are captured above; the
      // bracket regex matches them too but their semantic slots are
      // distinct from generic states.
      if (token.startsWith("ref=") || token.startsWith("box=")) continue;
      states.push(token);
    }

    const node: ElementNode = {
      ref: ref ?? nextSyntheticRef(),
      role,
      ...(name !== undefined && name.length > 0 ? { name } : {}),
      ...(bbox !== undefined ? { bbox } : {}),
      ...(states.length > 0 ? { states } : {}),
    };

    // Pop the stack until we find a frame at a strictly smaller
    // indent — that's our parent.
    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? -1) >= indent) {
      finalizeFrame(stack.pop()!);
    }

    const frame: StackFrame = { indent, node, children: [] };
    if (stack.length === 0) {
      rootChildren.push(node);
    } else {
      stack[stack.length - 1]!.children.push(node);
    }
    if (isContainer) {
      stack.push(frame);
    }
  }

  while (stack.length > 0) {
    finalizeFrame(stack.pop()!);
  }

  function finalizeFrame(frame: StackFrame): void {
    if (frame.children.length > 0) {
      (frame.node as { children: readonly ElementNode[] }).children = frame.children;
    }
  }

  // Build the canonical tree. If the YAML had exactly one top-level
  // entry, that's the root. Otherwise wrap with a synthetic
  // `generic` root so the schema's single-root invariant holds.
  let root: ElementNode;
  if (rootChildren.length === 1) {
    root = rootChildren[0]!;
  } else {
    root = {
      ref: nextSyntheticRef(),
      role: "generic",
      children: rootChildren,
    };
  }

  return {
    version: 1,
    source: {
      kind: "playwright",
      capturedAt: opts.capturedAt ?? new Date().toISOString(),
      ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
      ...(opts.url !== undefined ? { url: opts.url } : {}),
    },
    viewport: opts.viewport,
    root,
  };
}

/**
 * Options for `attachAttributes` — the convenience that walks an
 * already-built `ElementTree` and fills each node's `attributes` by
 * resolving its `match: { role, name }` against the live page.
 */
export interface AttachAttributesOptions {
  /** Whitelist of HTML attribute names to capture. Same shape as
   *  `DEFAULT_ATTR_WHITELIST` in `@ingcreators/annot-product-docs`. */
  whitelist: readonly string[];
}

/**
 * Walk an ElementTree and attach HTML attribute snapshots to each
 * node by resolving its role+name against the live page. Mutates
 * the tree in place AND returns it for fluent chaining.
 *
 * Resolution strategy: for each node with both `role` and `name`,
 * call `page.getByRole(role, { name, exact: true })`. When the
 * locator resolves to exactly one element, evaluate the whitelist
 * against it. Ambiguous / missing resolves are silently skipped —
 * the drift detector raises those (intentionally not duplicating
 * the diagnostic here).
 */
export async function attachAttributes(
  tree: ElementTree,
  page: AttachAttributesPage,
  options: AttachAttributesOptions,
): Promise<ElementTree> {
  interface NamedTarget {
    node: ElementNode;
    role: string;
    name: string;
  }
  const targets: NamedTarget[] = [];
  walkTree(tree, (node) => {
    // Skip nodes without a name — `getByRole` requires one for the
    // exact-match resolution we depend on. Decorative containers
    // (role=generic, no name) fall through here automatically.
    if (!node.role || !node.name) return;
    targets.push({ node, role: node.role, name: node.name });
  });

  for (const { node, role, name } of targets) {
    const locator = page.getByRole(role as Parameters<AttachAttributesPage["getByRole"]>[0], {
      name,
      exact: true,
    });
    const count = await locator.count();
    if (count !== 1) continue;
    const collected = await locator.evaluate((el: Element, names: readonly string[]) => {
      const out: Record<string, string> = {};
      for (const name of names) {
        const v = el.getAttribute(name);
        if (v !== null) out[name] = v;
      }
      return out;
    }, options.whitelist);
    if (Object.keys(collected).length === 0) continue;
    (node as { attributes: Readonly<Record<string, string>> }).attributes = collected;
  }

  return tree;
}

/**
 * Structural subset of Playwright `Page` that `attachAttributes`
 * needs. Real Playwright `Page` instances satisfy this; the trimmed
 * shape lets unit tests pass a minimal mock without pulling in
 * Playwright's full type graph.
 */
export interface AttachAttributesPage {
  getByRole(role: string, options: { name: string; exact: true }): AttachAttributesLocator;
}

export interface AttachAttributesLocator {
  count(): Promise<number>;
  evaluate<R, A>(fn: (el: Element, arg: A) => R, arg: A): Promise<R>;
}
