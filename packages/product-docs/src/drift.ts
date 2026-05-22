// Drift detection — compare authored `<Overlay>` blocks in an MDX
// file against the live Playwright `aria-snapshot` of the page,
// and report the differences.
//
// Phase 1 PR 4 of `docs/plans/living-product-docs.md`. The plan
// classifies six drift kinds:
//
//   - `added`          — element in live snapshot has no `<Overlay>`. Warning.
//   - `removed`        — `<Overlay match>` doesn't resolve to any element. Error.
//   - `renamed`        — `role` matches, `name` differs. Warning.
//   - `role-changed`   — `name` matches, `role` differs. Warning.
//   - `duplicated`     — `match` resolves to multiple elements. Error.
//   - `attribute-drift`— `annot:attributes` block doesn't match live attrs. Info.
//
// The function is pure — no Playwright, no file system. Callers
// (CLI / fixture) feed it parsed overlays, parsed snapshot entries,
// and optionally the stored `annot:attributes` YAML to detect
// `attribute-drift`. The CLI maps the findings to exit codes;
// `annot docs sync` runs `captureScreen` against the same MDX to
// fix the auto-fixable subset.

import { type ElementNode, type ElementTree, walkTree } from "@ingcreators/annot-core";

import type { OverlayEntry } from "./annotations-yaml.js";
import { parseSnapshot, type SnapshotEntry } from "./resolver.js";
import type { MatchKey, ScreenSpec } from "./types.js";

export type DriftSeverity = "error" | "warning" | "info";

export type DriftKind =
  | "added"
  | "removed"
  | "renamed"
  | "role-changed"
  | "duplicated"
  | "attribute-drift"
  // Phase 2c of `docs/plans/living-spec-authoring-roadmap.md`:
  // cross-references between annotation yaml `overlays[].id` and
  // MDX `<AnnotCallout for="id">`.
  | "description-missing"
  | "description-orphan";

export interface DriftFinding {
  severity: DriftSeverity;
  kind: DriftKind;
  /** The screen id the finding pertains to. */
  screenId: string;
  /** Human-readable description. */
  message: string;
  /** The `MatchKey` from the source MDX, if relevant. */
  match?: MatchKey;
  /** Suggested replacement (used by `--fix` flows in Phase 4). */
  suggestion?: { role?: string; name?: string };
}

export interface DetectDriftOptions {
  screen: ScreenSpec;
  /** Parsed Playwright aria-snapshot entries against the current page. */
  liveSnapshot: SnapshotEntry[];
  /** Optional verbatim YAML of the stored `annot:attributes` block. */
  storedAttributesYaml?: string;
  /** Optional verbatim YAML of the freshly-captured attributes. */
  freshAttributesYaml?: string;
  /**
   * Phase 2c of `docs/plans/living-spec-authoring-roadmap.md`.
   * When the screen carries `annotations="…"`, callers parse the
   * yaml and pass its overlays here. The detector then:
   *   - Pulls match keys from this list instead of
   *     `screen.overlays` for the match-cycle (removed / renamed /
   *     role-changed / duplicated / added).
   *   - Emits new cross-ref findings: `description-missing` (yaml
   *     id has no `<AnnotCallout for>`) and `description-orphan`
   *     (`<AnnotCallout for>` references a yaml id that doesn't
   *     exist).
   * Independent of `screen.overlays`: the legacy inline path stays
   * inert when this is set.
   */
  yamlOverlays?: readonly OverlayEntry[];
}

/**
 * Compute the drift findings for one `<Screen>` block.
 *
 * Severity policy:
 * - **error** stops `annot docs lint --ci` (non-zero exit). Removed
 *   + duplicated belong here because they fail rendering.
 * - **warning** logs but doesn't fail CI by default. Added + renamed
 *   + role-changed belong here because they're authoring tasks (the
 *   doc author decides whether the new element warrants an
 *   `<Overlay>`).
 * - **info** is silent unless `--verbose`; attribute-drift is here
 *   because `annot docs sync` rewrites the block automatically on
 *   the next CI run.
 */
export function detectDrift(opts: DetectDriftOptions): DriftFinding[] {
  const { screen, liveSnapshot, storedAttributesYaml, freshAttributesYaml, yamlOverlays } = opts;
  const findings: DriftFinding[] = [];

  // Phase 2c: when `yamlOverlays` is set, the screen has migrated
  // to the new `<Screen annotations="…">` form — match-cycle
  // findings come from the yaml's entries instead of the inline
  // `<Overlay>` JSX. Both shapes carry `match: MatchKey`, so the
  // detector body is identical apart from the source array.
  const overlayMatchSource: readonly { match: MatchKey }[] = yamlOverlays ?? screen.overlays;

  // ── Per-overlay: removed / renamed / role-changed / duplicated ─

  // Track live entries already accounted for by a per-overlay
  // finding so the `added` pass below doesn't double-count them.
  // E.g. when a `<Overlay match={{role:"textbox", name:"Email"}}`
  // resolves to a live `searchbox "Email"`, we emit a single
  // `role-changed` finding — the live `searchbox "Email"` MUST
  // NOT also trigger an `added` warning.
  const accountedFor = new Set<string>();

  for (const overlay of overlayMatchSource) {
    const hits = liveSnapshot.filter(
      (e) => e.role === overlay.match.role && e.name === overlay.match.name,
    );

    if (hits.length > 1) {
      findings.push({
        severity: "error",
        kind: "duplicated",
        screenId: screen.id,
        message: `Multiple elements match role="${overlay.match.role}" name="${overlay.match.name}". Use \`under\` to disambiguate.`,
        match: overlay.match,
      });
      continue;
    }

    if (hits.length === 1) continue; // happy path

    // Zero hits — diagnose why.
    const sameName = liveSnapshot.filter((e) => e.name === overlay.match.name);
    if (sameName.length === 1 && sameName[0]!.role !== overlay.match.role) {
      const target = sameName[0]!;
      accountedFor.add(`${target.role}|${target.name}`);
      findings.push({
        severity: "warning",
        kind: "role-changed",
        screenId: screen.id,
        message: `Element with name="${overlay.match.name}" exists but has role="${target.role}", not "${overlay.match.role}".`,
        match: overlay.match,
        suggestion: { role: target.role },
      });
      continue;
    }
    const sameRole = liveSnapshot.filter((e) => e.role === overlay.match.role);
    if (sameRole.length > 0) {
      const closest = pickClosest(
        overlay.match.name,
        sameRole.map((e) => e.name),
      );
      if (closest) {
        accountedFor.add(`${overlay.match.role}|${closest}`);
        findings.push({
          severity: "warning",
          kind: "renamed",
          screenId: screen.id,
          message: `No element with role="${overlay.match.role}" name="${overlay.match.name}". Closest match: name="${closest}".`,
          match: overlay.match,
          suggestion: { name: closest },
        });
        continue;
      }
    }
    findings.push({
      severity: "error",
      kind: "removed",
      screenId: screen.id,
      message: `No element with role="${overlay.match.role}" name="${overlay.match.name}".`,
      match: overlay.match,
    });
  }

  // ── Live-side: added — elements with no overlay ─────────────

  const overlayKeys = new Set(overlayMatchSource.map((o) => `${o.match.role}|${o.match.name}`));
  for (const entry of liveSnapshot) {
    if (!isInteractive(entry.role)) continue;
    const key = `${entry.role}|${entry.name}`;
    if (overlayKeys.has(key)) continue;
    if (accountedFor.has(key)) continue;
    findings.push({
      severity: "warning",
      kind: "added",
      screenId: screen.id,
      message: `New ${entry.role} "${entry.name}" on the page has no <Overlay>.`,
      suggestion: { role: entry.role, name: entry.name },
    });
  }

  // ── Phase 2c: description cross-refs (yaml id ↔ <AnnotCallout for>) ──

  if (yamlOverlays !== undefined) {
    const yamlIds = new Set(yamlOverlays.map((o) => o.id));
    const calloutIds = new Set(screen.callouts.map((c) => c.for));
    for (const overlay of yamlOverlays) {
      if (!calloutIds.has(overlay.id)) {
        findings.push({
          severity: "warning",
          kind: "description-missing",
          screenId: screen.id,
          message: `annotations yaml has \`overlays[].id="${overlay.id}"\` but no <AnnotCallout for="${overlay.id}"> in MDX.`,
          match: overlay.match,
        });
      }
    }
    for (const callout of screen.callouts) {
      if (!yamlIds.has(callout.for)) {
        findings.push({
          severity: "error",
          kind: "description-orphan",
          screenId: screen.id,
          message: `<AnnotCallout for="${callout.for}"> has no matching entry in annotations yaml \`overlays[]\`.`,
        });
      }
    }
  }

  // ── Attribute drift ──────────────────────────────────────────

  if (storedAttributesYaml !== undefined && freshAttributesYaml !== undefined) {
    if (normaliseYaml(storedAttributesYaml) !== normaliseYaml(freshAttributesYaml)) {
      findings.push({
        severity: "info",
        kind: "attribute-drift",
        screenId: screen.id,
        message:
          "`annot:attributes` block no longer matches live element attributes. Run `annot docs sync` to update.",
      });
    }
  }

  return findings;
}

/**
 * Convenience: parse the stored snapshot YAML + dispatch.
 *
 * Used by the CLI when comparing the persisted `annot:snapshot`
 * comment block against a fresh page snapshot — e.g. for an
 * offline `annot docs lint --offline` mode (Phase 4 polish).
 */
export function detectDriftFromYaml(args: {
  screen: ScreenSpec;
  liveSnapshotYaml: string;
  storedAttributesYaml?: string;
  freshAttributesYaml?: string;
  /** Phase 2c. See {@link DetectDriftOptions.yamlOverlays}. */
  yamlOverlays?: readonly OverlayEntry[];
}): DriftFinding[] {
  return detectDrift({
    screen: args.screen,
    liveSnapshot: parseSnapshot(args.liveSnapshotYaml),
    storedAttributesYaml: args.storedAttributesYaml,
    freshAttributesYaml: args.freshAttributesYaml,
    yamlOverlays: args.yamlOverlays,
  });
}

/**
 * Convert an `ElementTree` (Phase 1a of
 * `docs/plans/living-spec-authoring-roadmap.md`) into the
 * `SnapshotEntry[]` shape the drift detector consumes. Pure data
 * transform — walks the tree depth-first, emits one entry per node
 * that has both `role` and `name` (decorative containers and
 * synthetic roots are skipped, matching the legacy parser's filter).
 *
 * Phase 1i. Exposed for tests + callers that want to construct
 * adapters in front of the existing `detectDrift` API without
 * paying the YAML detour.
 */
export function elementTreeToSnapshotEntries(tree: ElementTree): SnapshotEntry[] {
  const out: SnapshotEntry[] = [];
  walkTree(tree, (node, parents) => {
    if (!node.role || !node.name) return;
    out.push({
      role: node.role,
      name: node.name,
      ref: node.ref,
      depth: parents.length,
      ancestors: parents
        .filter((p): p is ElementNode & { name: string } => typeof p.name === "string")
        .map((p) => ({ role: p.role, name: p.name })),
    });
  });
  return out;
}

/**
 * Drift detection driven by an `ElementTree` (the canonical
 * screen-capture model from Phase 1a) instead of the legacy
 * YAML-parsed `SnapshotEntry[]`. Internally converts the tree
 * via `elementTreeToSnapshotEntries` and dispatches to
 * `detectDrift` — both paths produce identical findings for
 * equivalent inputs.
 *
 * Phase 1i. Lets the CLI's `lint` flow consume the new PNG XMP
 * `annot:elementTree` chunk directly (via `readElementTreePng`)
 * without round-tripping through Playwright YAML.
 */
export function detectDriftFromElementTree(args: {
  screen: ScreenSpec;
  liveElementTree: ElementTree;
  storedAttributesYaml?: string;
  freshAttributesYaml?: string;
  /** Phase 2c. See {@link DetectDriftOptions.yamlOverlays}. */
  yamlOverlays?: readonly OverlayEntry[];
}): DriftFinding[] {
  return detectDrift({
    screen: args.screen,
    liveSnapshot: elementTreeToSnapshotEntries(args.liveElementTree),
    storedAttributesYaml: args.storedAttributesYaml,
    freshAttributesYaml: args.freshAttributesYaml,
    yamlOverlays: args.yamlOverlays,
  });
}

/**
 * Summarise findings by severity. Used by the CLI to decide an
 * exit code.
 */
export function summariseDrift(findings: DriftFinding[]): {
  errors: number;
  warnings: number;
  infos: number;
} {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const f of findings) {
    if (f.severity === "error") errors++;
    else if (f.severity === "warning") warnings++;
    else infos++;
  }
  return { errors, warnings, infos };
}

// ─── helpers ───────────────────────────────────────────────────

/**
 * "Interactive" roles for the `added` detector — we don't want
 * `region` / `paragraph` / `presentation` etc. spamming warnings
 * because they're not the kind of thing an author overlays
 * documentation on. Aligned with the WAI-ARIA "widget" + key
 * landmark roles, plus the ones Playwright's `aria-snapshot`
 * commonly emits.
 */
const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

function isInteractive(role: string): boolean {
  return INTERACTIVE_ROLES.has(role);
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

/** Collapse trailing whitespace + drop blank lines — so YAML
 *  reformatting noise doesn't false-positive attribute drift.
 *  `String#trimEnd` avoids the polynomial backtracking CodeQL
 *  flags for the equivalent `/\s+$/` regex on unbounded library
 *  input. */
function normaliseYaml(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .join("\n");
}

/**
 * A `<Screen>` is drift-checkable when it has at least one
 * `<Overlay>` (legacy form), an `annotations` ref (yaml form), or
 * an `<AnnotCallout>` (yaml form, in case the author wrote callouts
 * before the yaml). Files without `<Screen>` blocks (cover / history
 * / list / reference MDXs) are skipped by the lint walker.
 */
export function isLintableScreen(screen: ScreenSpec): boolean {
  return (
    screen.overlays.length > 0 || screen.annotations !== undefined || screen.callouts.length > 0
  );
}

/**
 * Filter the list of `ScreenSpec`s in a parsed MDX to just the
 * ones drift detection should touch. Helps the CLI keep the
 * "skipped cover.mdx" path cheap.
 */
export function lintableScreens(screens: ScreenSpec[]): ScreenSpec[] {
  return screens.filter(isLintableScreen);
}
