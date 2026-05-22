/**
 * Soft-deprecation shim for the legacy inline `<Overlay>` JSX
 * form. Phase 2e of `docs/plans/living-spec-authoring-roadmap.md`.
 *
 * Policy (per OQ-08 of the roadmap):
 *
 * - Phase 2e (this module) — Build / lint paths emit a deduped
 *   warning when they encounter a `<Screen>` block whose overlays
 *   live inline as `<Overlay>` children rather than yaml + AnnotCallout.
 *   The warning points at `annot docs migrate-overlays-to-annotations`
 *   so authors can fix it with one command.
 *
 * - Removal target: ~3 months / 2-3 release cycles after Phase 2e
 *   lands, tracked in [the roadmap](../../../docs/plans/living-spec-authoring-roadmap.md)
 *   timeline. Removal is its own PR that deletes:
 *     - `OverlaySpec` from `./types.ts`
 *     - `Overlay.astro` from `@ingcreators/annot-product-docs-astro`
 *     - The inline-`<Overlay>` walker branch in `./mdx.ts`
 *     - The legacy path in `renderAnnotatedScreen` (yaml becomes
 *       the only renderer input)
 *
 * Until then, both forms work. The warning is `console.warn`-only
 * — it doesn't fail the build by default (CI gating happens at
 * `annot docs lint --ci`, not at Astro build time).
 */

/**
 * Dedup key for the per-process warning cache. One warning per
 * (mdxPath × screenId) pair per process. Re-importing the module
 * resets the cache, which is fine for short-lived CLIs and matches
 * the "warn once per session" intuition.
 */
const warned = new Set<string>();

export interface LegacyOverlayUsage {
  /** Absolute MDX path (or any stable identifier the caller has). */
  mdxPath: string;
  /** `<Screen id>` of the block using the legacy form. */
  screenId: string;
  /** Number of `<Overlay>` children seen on the screen. */
  overlayCount: number;
}

/**
 * Emit the deprecation warning. No-op when the same
 * `(mdxPath, screenId)` pair has already warned in this process.
 *
 * The caller (Astro Image Service, lint CLI) decides WHEN to
 * call this — typically when it sees `screen.overlays.length > 0
 * && screen.annotations === undefined`.
 *
 * @param emit  Optional warning emitter. Defaults to `console.warn`
 *              so the message lands on whichever transport the
 *              host already wires up (Astro logs / CLI stderr / etc.).
 *              Tests inject a spy.
 */
export function warnLegacyOverlay(
  usage: LegacyOverlayUsage,
  emit: (line: string) => void = (l) => console.warn(l),
): void {
  const key = `${usage.mdxPath}\0${usage.screenId}`;
  if (warned.has(key)) return;
  warned.add(key);
  emit(formatLegacyOverlayWarning(usage));
}

/**
 * Render the warning message. Exported so tests + bespoke
 * formatters (CI / GitHub Annotations / etc.) can drive it
 * without going through `console.warn`.
 */
export function formatLegacyOverlayWarning(usage: LegacyOverlayUsage): string {
  return (
    `[annot-docs] DEPRECATED: ${usage.mdxPath} screen "${usage.screenId}" uses ` +
    `${usage.overlayCount} inline <Overlay> block(s). Run ` +
    "`annot docs migrate-overlays-to-annotations` to extract them into a " +
    "`.annotations.yaml` file + <AnnotCallout for=…> JSX. The inline " +
    "<Overlay> form is supported during a deprecation window; see OQ-08 in " +
    "docs/plans/living-spec-authoring-roadmap.md for the removal schedule."
  );
}

/**
 * Test-only: reset the per-process dedup cache. Lets tests
 * exercise the dedup path with a clean slate.
 */
export function _resetLegacyOverlayDedupForTests(): void {
  warned.clear();
}
