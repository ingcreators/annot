// Stage 3b: Match resolution.
//
// Given:
//   - A list of overlays from the MDX (`{ match: { role, name } }`)
//   - A live Playwright `Page`
//
// Produce:
//   - For each overlay, either a bounding box on the page,
//     or a structured drift error describing why match failed.

import type { MatchKey, OverlaySpec } from "./parse-mdx.ts";

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResolvedOverlay =
  | { status: "resolved"; overlay: OverlaySpec; bbox: BBox; snapshotMatch: string }
  | { status: "not-found"; overlay: OverlaySpec; reason: string }
  | { status: "ambiguous"; overlay: OverlaySpec; candidates: string[] }
  | { status: "role-name-renamed"; overlay: OverlaySpec; suggestion: string };

export interface SnapshotEntry {
  role: string;
  name: string;
  ref: string;
  depth: number;
}

/**
 * Parse the YAML aria-snapshot output from `page.locator('body')
 * .ariaSnapshot({ mode: 'ai' })` into a flat list of entries.
 *
 * The format is:
 *   - textbox "Email" [ref=e3]
 *   - button "Sign in" [ref=e9]
 *
 * With nesting:
 *   - dialog "Confirm":
 *     - button "OK" [ref=e12]
 *     - button "Cancel" [ref=e13]
 */
export function parseSnapshot(yaml: string): SnapshotEntry[] {
  const entries: SnapshotEntry[] = [];
  const lines = yaml.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.length - line.replace(/^\s+/, "").length;
    const depth = Math.floor(indent / 2);

    // Two-pass parsing — Playwright's aria-snapshot output has
    // trailing attribute brackets (e.g. `[cursor=pointer]`,
    // `[level=1]`) that a single anchored regex can't elegantly
    // skip. Match the role/name prefix, then independently
    // extract `[ref=eN]` from anywhere on the line.
    const head = line.match(/^\s*-\s+([a-z]+)(?:\s+"([^"]*?)")?/);
    if (!head) continue;
    const refMatch = line.match(/\[ref=([^\]]+)\]/);
    if (!refMatch) continue; // container without interaction
    const role = head[1] ?? "";
    const name = head[2] ?? "";
    const ref = refMatch[1] ?? "";
    entries.push({ role, name, ref, depth });
  }

  return entries;
}

interface PageLike {
  getByRole(
    role: string,
    options?: { name?: string; exact?: boolean },
  ): {
    boundingBox(): Promise<BBox | null>;
    count(): Promise<number>;
  };
}

/**
 * Resolve a single MatchKey against the parsed snapshot + live
 * page. Returns a typed result for the caller to render or
 * report.
 */
export async function resolveMatch(
  match: MatchKey,
  snapshot: SnapshotEntry[],
  page: PageLike,
): Promise<{ ok: true; bbox: BBox; entry: SnapshotEntry } | { ok: false; reason: string; suggestion?: string; candidates?: string[] }> {
  // Step 1: look in the snapshot for exact role+name matches.
  const exact = snapshot.filter(
    (e) => e.role === match.role && e.name === match.name,
  );

  if (exact.length === 0) {
    // Try heuristic match: same role, similar name.
    const sameRole = snapshot.filter((e) => e.role === match.role);
    if (sameRole.length > 0) {
      const closest = pickClosest(match.name, sameRole.map((e) => e.name));
      if (closest) {
        return {
          ok: false,
          reason: `No element with role="${match.role}" and name="${match.name}". Closest match: name="${closest}".`,
          suggestion: closest,
        };
      }
    }
    return {
      ok: false,
      reason: `No element with role="${match.role}" and name="${match.name}".`,
    };
  }

  if (exact.length > 1) {
    // Could try to disambiguate via match.under — Phase 1 work.
    // For PoC, report ambiguity.
    return {
      ok: false,
      reason: `Multiple elements match role="${match.role}" name="${match.name}". Use \`under\` to disambiguate.`,
      candidates: exact.map((e) => `[ref=${e.ref}]`),
    };
  }

  // Step 2: get bbox from the live page.
  const locator = page.getByRole(match.role, { name: match.name, exact: true });
  const count = await locator.count();
  if (count === 0) {
    return {
      ok: false,
      reason: `Snapshot says element exists but live locator failed: role="${match.role}" name="${match.name}".`,
    };
  }
  if (count > 1) {
    return {
      ok: false,
      reason: `Live locator returns ${count} elements for role="${match.role}" name="${match.name}".`,
      candidates: exact.map((e) => `[ref=${e.ref}]`),
    };
  }
  const bbox = await locator.boundingBox();
  if (!bbox) {
    return {
      ok: false,
      reason: `Live locator resolved but boundingBox() returned null (element not rendered).`,
    };
  }

  return { ok: true, bbox, entry: exact[0]! };
}

/**
 * Resolve every overlay, returning one ResolvedOverlay per
 * input. Caller decides what to do with errors (drift report
 * or stop the render).
 */
export async function resolveAllOverlays(
  overlays: OverlaySpec[],
  snapshot: SnapshotEntry[],
  page: PageLike,
): Promise<ResolvedOverlay[]> {
  const results: ResolvedOverlay[] = [];
  for (const overlay of overlays) {
    const r = await resolveMatch(overlay.match, snapshot, page);
    if (r.ok) {
      results.push({
        status: "resolved",
        overlay,
        bbox: r.bbox,
        snapshotMatch: `[ref=${r.entry.ref}]`,
      });
    } else if (r.candidates && r.candidates.length > 1) {
      results.push({ status: "ambiguous", overlay, candidates: r.candidates });
    } else if (r.suggestion) {
      results.push({ status: "role-name-renamed", overlay, suggestion: r.suggestion });
    } else {
      results.push({ status: "not-found", overlay, reason: r.reason });
    }
  }
  return results;
}

// ─── tiny string-similarity helper ─────────────────────────────

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
  // Require some minimum similarity before suggesting.
  return bestScore > 0.3 ? best : null;
}

function scoreSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  // Trigram overlap — cheap and works for Japanese + English.
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
