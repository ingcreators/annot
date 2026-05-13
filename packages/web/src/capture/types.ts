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

/** Lifecycle state of a candidate inside the in-memory `CandidateStore`. */
export type CaptureCandidateStatus = "candidate" | "accepted" | "deleted";
// TODO(spec-phase-5): "editing" | "export-ready"

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

/** A single captured frame buffered before the user accepts or
 *  deletes it. Auto Capture pushes here; Capture Once and Capture
 *  Area save directly via `storage.saveImage()` and never produce a
 *  candidate. */
export interface CaptureCandidate {
  id: string;
  status: CaptureCandidateStatus;
  createdAt: string;
  sourceWidth: number;
  sourceHeight: number;
  imageBlob: Blob;
  thumbnailDataUrl: string;
  diffScore?: number;
  // TODO(spec-phase-5): title, savedWidth/Height, format, sourceRect.
}
