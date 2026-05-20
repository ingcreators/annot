// Match resolver — turn a persistent `MatchKey` ({ role, name,
// under? }) into a live Playwright `Locator` against the current
// snapshot.
//
// Phase 1 PR 2 of `docs/plans/living-product-docs.md`. The
// resolver is the bridge between the *MDX-time* identity of an
// element (`<Overlay match={{ role: "button", name: "Sign in" }}>`)
// and the *runtime* identity Playwright sees on the page. It
// stays in pure Node land — no DOM dependency beyond what
// `@playwright/test` brings in transitively for callers.

import type { Locator, Page } from "@playwright/test";

import type { MatchKey, OverlaySpec } from "./types.js";

export interface SnapshotEntry {
  role: string;
  name: string;
  ref: string;
  depth: number;
  /** Parent chain at parse time, oldest ancestor first. Used by `under`. */
  ancestors: Array<{ role: string; name: string }>;
}

export type ResolveResult =
  | { ok: true; locator: Locator; entry: SnapshotEntry }
  | {
      ok: false;
      kind: ResolveFailureKind;
      reason: string;
      suggestion?: string;
      candidates?: string[];
    };

export type ResolveFailureKind =
  | "not-found"
  | "ambiguous"
  | "live-mismatch"
  | "renamed"
  | "role-changed";

/**
 * Parse the YAML-ish aria-snapshot output from
 * `page.locator('body').ariaSnapshot({ mode: 'ai' })` into a
 * flat list of entries with parent-chain context.
 *
 * Playwright emits a 2-space-per-level indented bullet list:
 *
 *   - dialog "Confirm":
 *     - button "OK" [ref=e12]
 *     - button "Cancel" [ref=e13]
 *
 * Each line is `- <role> "<name>" [ref=eN]` optionally followed
 * by `:` (for containers). We walk the lines once, maintaining a
 * parent stack so each entry knows its full ancestor chain — the
 * resolver uses that chain to honour `match.under` for
 * disambiguation.
 */
export function parseSnapshot(yaml: string): SnapshotEntry[] {
  const entries: SnapshotEntry[] = [];
  const lines = yaml.split(/\r?\n/);

  interface StackFrame {
    depth: number;
    role: string;
    name: string;
  }
  const ancestorStack: StackFrame[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.length - line.replace(/^\s+/, "").length;
    const depth = Math.floor(indent / 2);

    const head = line.match(/^\s*-\s+([a-z]+)(?:\s+"([^"]*?)")?/);
    if (!head) continue;
    const role = head[1] ?? "";
    const name = head[2] ?? "";

    // Pop ancestors at or below this depth before recording.
    while (
      ancestorStack.length > 0 &&
      (ancestorStack[ancestorStack.length - 1]?.depth ?? -1) >= depth
    ) {
      ancestorStack.pop();
    }
    const ancestors = ancestorStack.map((f) => ({ role: f.role, name: f.name }));

    const refMatch = line.match(/\[ref=([^\]]+)\]/);
    if (refMatch) {
      entries.push({
        role,
        name,
        ref: refMatch[1] ?? "",
        depth,
        ancestors,
      });
    }

    // Container line (no ref, trailing `:`) — push onto the
    // ancestor stack so children record this as their parent.
    if (/:\s*$/.test(line)) {
      ancestorStack.push({ depth, role, name });
    }
  }

  return entries;
}

/**
 * Resolve a single `MatchKey` against a parsed snapshot + live
 * `Page`. Honours `match.under` by filtering candidate entries
 * whose ancestor chain ends with the `under` key.
 */
export async function resolveMatch(
  match: MatchKey,
  snapshot: SnapshotEntry[],
  page: Page,
): Promise<ResolveResult> {
  const filtered = filterByUnder(
    snapshot.filter((e) => e.role === match.role && e.name === match.name),
    match.under,
  );

  if (filtered.length === 0) {
    return diagnoseMiss(match, snapshot);
  }

  if (filtered.length > 1) {
    return {
      ok: false,
      kind: "ambiguous",
      reason: `Multiple elements match role="${match.role}" name="${match.name}". Use \`under\` to disambiguate.`,
      candidates: filtered.map((e) => `[ref=${e.ref}]`),
    };
  }

  const entry = filtered[0]!;
  const locator = buildLocator(page, match);
  const count = await locator.count();
  if (count === 0) {
    return {
      ok: false,
      kind: "live-mismatch",
      reason: `Snapshot says element exists but live locator failed: role="${match.role}" name="${match.name}".`,
    };
  }
  if (count > 1) {
    return {
      ok: false,
      kind: "ambiguous",
      reason: `Live locator returns ${count} elements for role="${match.role}" name="${match.name}".`,
    };
  }

  return { ok: true, locator, entry };
}

/**
 * Resolve every `<Overlay>` in a screen against the snapshot.
 * Returns one result per overlay in input order, so the caller
 * can pair them with the source spans for drift reports.
 */
export async function resolveOverlays(
  overlays: OverlaySpec[],
  snapshot: SnapshotEntry[],
  page: Page,
): Promise<Array<{ overlay: OverlaySpec; result: ResolveResult }>> {
  const results: Array<{ overlay: OverlaySpec; result: ResolveResult }> = [];
  for (const overlay of overlays) {
    results.push({ overlay, result: await resolveMatch(overlay.match, snapshot, page) });
  }
  return results;
}

// ─── helpers ───────────────────────────────────────────────────

function buildLocator(page: Page, match: MatchKey): Locator {
  let loc = page.getByRole(match.role as Parameters<Page["getByRole"]>[0], {
    name: match.name,
    exact: true,
  });
  if (match.under) {
    // For `under`, scope the locator to a wrapper found via the
    // same role/name pair. Playwright's `locator.filter({ has })`
    // would be more correct (it filters descendants of the
    // overlay's candidate rather than scoping a fresh search) —
    // but `getByRole().filter({ has: getByRole() })` doesn't
    // express the inverse "this descendant has an ancestor X"
    // relation. We instead scope from the parent and re-search,
    // which gives the same semantics as the snapshot ancestor
    // check.
    const parent = page.getByRole(match.under.role as Parameters<Page["getByRole"]>[0], {
      name: match.under.name,
      exact: true,
    });
    loc = parent.getByRole(match.role as Parameters<Page["getByRole"]>[0], {
      name: match.name,
      exact: true,
    });
  }
  return loc;
}

function filterByUnder(candidates: SnapshotEntry[], under: MatchKey | undefined): SnapshotEntry[] {
  if (!under) return candidates;
  return candidates.filter((e) =>
    e.ancestors.some((a) => a.role === under.role && a.name === under.name),
  );
}

function diagnoseMiss(match: MatchKey, snapshot: SnapshotEntry[]): ResolveResult {
  // No exact role+name. Look for "same name, different role" —
  // that's a role-changed diagnostic.
  const sameName = snapshot.filter((e) => e.name === match.name);
  if (sameName.length === 1 && sameName[0]!.role !== match.role) {
    return {
      ok: false,
      kind: "role-changed",
      reason: `Element with name="${match.name}" exists but has role="${sameName[0]!.role}", not "${match.role}".`,
      suggestion: sameName[0]!.role,
    };
  }

  // "Same role, different name" — likely a label rename.
  const sameRole = snapshot.filter((e) => e.role === match.role);
  if (sameRole.length > 0) {
    const closest = pickClosest(
      match.name,
      sameRole.map((e) => e.name),
    );
    if (closest) {
      return {
        ok: false,
        kind: "renamed",
        reason: `No element with role="${match.role}" name="${match.name}". Closest match: name="${closest}".`,
        suggestion: closest,
      };
    }
  }

  return {
    ok: false,
    kind: "not-found",
    reason: `No element with role="${match.role}" name="${match.name}".`,
  };
}

function pickClosest(target: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  let bestScore = scoreSimilarity(target, best);
  for (const c of candidates.slice(1)) {
    const s = scoreSimilarity(target, c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return bestScore > 0.3 ? best : null;
}

function scoreSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  // Trigram overlap — works for both Japanese and English. Cheap
  // (no DP, no allocations beyond two Sets) and good enough for
  // "did this label get renamed?" diagnostics.
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let overlap = 0;
  for (const g of ga) if (gb.has(g)) overlap++;
  return overlap / Math.max(ga.size, gb.size);
}
