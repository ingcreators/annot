/**
 * Capture message envelopes — moved into
 * `@ingcreators/annot-capture/shared/messages` in Phase 1A of
 * `docs/plans/desktop-browser-mode.md`. This file is kept as a
 * back-compat re-export so callers within the extension don't have
 * to rewrite import paths in lockstep.
 */

export type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  Message,
  OffscreenMessage,
  OffscreenResult,
  PopupMessage,
} from "@ingcreators/annot-capture/shared";
