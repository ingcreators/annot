/**
 * Pure assertion helpers shared across `@ingcreators/annot-core`,
 * `@ingcreators/annot-web`, and `@ingcreators/annot-extension`.
 *
 * Phase 6 of `docs/plans/source-audit-cleanup.md` introduced the
 * `assertNonNull` helper as the replacement for the long tail of
 * silent `value!` non-null assertions: when the assertion is
 * actually a load-bearing runtime invariant (and not a "the
 * compiler should have known this" situation), routing through
 * this helper turns a misleading `Cannot read properties of null`
 * crash into a meaningful labelled error.
 *
 * DOM-free — exported from the headless entry point too.
 */

/**
 * Assert that `v` is neither `null` nor `undefined`. On failure,
 * throw an `Error` whose message is `Assertion failed: <label>`.
 *
 * Prefer this over a bare `value!` whenever:
 *   - The non-null guarantee depends on a runtime invariant a
 *     reader can't see at the use site (e.g. "by this point in
 *     `setupEditor`, `#canvas` has been mounted").
 *   - The guarantee is fragile (e.g. depends on a Lit element's
 *     render cycle), and a future refactor could break it.
 *
 * Bare `!` stays acceptable for self-evident cases — e.g.
 * `array.find(...)!` where the search predicate guarantees a hit
 * by construction. Add a one-line comment if the guarantee
 * isn't obvious from the surrounding three lines of code.
 */
export function assertNonNull<T>(v: T | null | undefined, label: string): T {
  if (v === null || v === undefined) {
    throw new Error(`Assertion failed: ${label}`);
  }
  return v;
}
