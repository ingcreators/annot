/**
 * Web-capture domain types — colocated under `packages/web/src/capture/`
 * because no non-web host consumes them today (per
 * `docs/plans/web-capture-redesign.md` §"Architectural decisions").
 */

/** Modes the `Capture Screen...` dialog offers.
 *  - `auto`: change-detection-based candidate collection (Phase 4).
 *  - `once`: single-frame capture (today's `Capture Screen`).
 *
 *  Capture Area was originally planned as a third mode but was
 *  retired during the rollout — users get the same outcome via
 *  the editor's Crop tool after a Capture Once. Dropping it
 *  keeps the dialog focused on the two capture *behaviours*
 *  (one-shot vs. change-driven) rather than mixing in a post-
 *  capture cropping decision. */
export type CaptureMode = "auto" | "once";

/** State machine for the Auto Capture engine (Phase 4). */
export type AutoCaptureState = "idle" | "changing" | "stable-wait" | "captured";

/** Tunable knobs for one capture session. Phases 1–4 use only the
 *  fields below. spec Phase 5 (deferred) extends with the items in
 *  the TODO comment. */
export interface CaptureSettings {
  mode: CaptureMode;
  includeCursor: boolean;
  ignoreCursorOnlyChanges: boolean;
  // Auto-only:
  intervalMs: number;
  stableWaitMs: number;
  minMsBetweenCaptures: number;
  comparisonWidth: number;
  // TODO(spec-phase-5): saveSizePreset, encodeFormat ("smart" | "png" | "jpeg"
  //                     mirroring `EncodeOptions.format`),
  //                     changeSensitivity, thumbnailWidth,
  //                     keepOriginalForAccepted.
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  mode: "auto",
  includeCursor: true,
  ignoreCursorOnlyChanges: true,
  intervalMs: 1000,
  stableWaitMs: 700,
  minMsBetweenCaptures: 1500,
  comparisonWidth: 320,
};

/** One image saved during a /capture session.
 *
 *  Originally Phase 3 buffered an in-memory `Blob` here pending an
 *  Accept gate (the workspace would call `storage.saveImage()` only
 *  after the user accepted). Real usage showed the gate was friction
 *  + the in-memory buffer leaked tens-of-MB per candidate at 4K, so
 *  the model flipped: every captured frame is persisted to storage
 *  immediately, the session panel renders the saved records, and
 *  Delete in the panel actually deletes from storage. `path` is the
 *  authoritative key + the same id `<annot-candidate-card>` emits
 *  on its `candidate-delete` event. */
export interface CaptureCandidate {
  /** Identical to `path`. Kept as a separate field so the card
   *  element can stay schema-agnostic — events carry `id`, callers
   *  resolve to `path` via this field. */
  id: string;
  /** Storage path of the saved image. The image is already in the
   *  active `StorageProvider`'s `currentFolderPath`. */
  path: string;
  createdAt: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Same small thumbnail data URL the gallery would show — produced
   *  by `generateThumbnailFromDataUrl` (≤ 480px wide, JPEG @ 85%).
   *  Keeps the panel light + ensures the gallery `ThumbnailManager`
   *  cache is already warm by the time the user revisits. */
  thumbnailDataUrl: string;
  diffScore?: number;
}
