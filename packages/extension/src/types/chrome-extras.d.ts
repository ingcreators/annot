/**
 * Augmentations for `chrome-types@0.1.425` for APIs that the
 * package's auto-generated typings don't cover yet.
 *
 * Currently:
 *   - `chrome.offscreen.hasDocument()` — present in Chrome since
 *     v116, used to check whether the extension already has an
 *     offscreen document (so we don't try to create a second one).
 *
 * If `chrome-types` catches up to upstream and starts shipping
 * the missing methods, this file becomes redundant and can be
 * deleted.
 *
 * Phase 5 of `docs/plans/source-audit-cleanup.md`.
 */

declare namespace chrome {
  namespace offscreen {
    function hasDocument(): Promise<boolean>;
  }
}
