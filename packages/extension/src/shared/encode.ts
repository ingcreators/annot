/**
 * Settings-driven encode adapter — moved into
 * `@ingcreators/annot-capture/shared/encode` in Phase 1A of
 * `docs/plans/desktop-browser-mode.md`. This file is kept as a
 * back-compat re-export so callers within the extension don't have
 * to rewrite import paths in lockstep.
 */

export { type EncodeResult, encodeCapture } from "@ingcreators/annot-capture/shared";
