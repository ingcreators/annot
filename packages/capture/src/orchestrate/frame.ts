/**
 * `CaptureFrame` / `CaptureResult` shapes returned by the orchestrators.
 *
 * The orchestrator hands back encoded image data + DOM metadata; the
 * caller (extension service-worker, future desktop Browse-window
 * renderer) handles persistence / session-grouping / "open the editor
 * on this record". Keeping persistence off the seam means
 * extension-specific concerns (IDB tags, click/hotkey session
 * bookkeeping, "open or reuse the PWA tab" routing) don't leak into
 * the shared orchestrator.
 */

import type { ElementTree } from "@ingcreators/annot-core";
import type { CaptureTargetRef } from "../host.js";
import type { CaptureKind } from "../shared/settings.js";

export interface CaptureFrame {
  /** Encoded image data URL (PNG / JPEG / PNG-8 per the user's
   *  quality settings). */
  dataUrl: string;
  /** Pixel width of the encoded image. */
  width: number;
  /** Pixel height of the encoded image. */
  height: number;
  /** Optional canonical `ElementTree` snapshotted alongside the
   *  capture. Hosts that can produce one (Chrome extension + Electron
   *  Browse-window) populate it; pasted / desktop-screenshot captures
   *  leave it undefined. */
  elementTree?: ElementTree;
}

export interface CaptureResult {
  /** Resolved capture target. The caller uses `target.url` /
   *  `target.title` for source-URL tagging on saved records. */
  target: CaptureTargetRef;
  /** One element for visible / area / scroll captures; multiple for
   *  per-page captures. */
  frames: CaptureFrame[];
  /** Stable identifier the caller can use as a session-id input. */
  kind: CaptureKind;
}
