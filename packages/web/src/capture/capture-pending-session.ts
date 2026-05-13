/**
 * `CapturePendingSession` — module-singleton that holds the
 * dialog-confirmed `{ mode, cursor, folderPath }` between the
 * `Capture Screen...` dialog resolving and the `/capture` route
 * mounting `<annot-capture-workspace>`.
 *
 * Phase 2 of `docs/plans/web-capture-redesign.md`. The pending state
 * is intentionally NOT in the URL — the workspace doesn't
 * round-trip these settings on a page reload (the user would
 * have to re-grant `getDisplayMedia` anyway), and keeping them
 * out of the URL avoids leaking the user's folder path into
 * browser history.
 *
 * Direct navigation to `/capture` without a pending session
 * triggers the workspace's "no pending session" hint and a button
 * that re-opens the dialog.
 */

import type { CursorMode } from "./capture-prefs.js";
import type { CaptureMode } from "./types.js";

export interface CapturePendingSession {
  mode: CaptureMode;
  cursor: CursorMode;
  folderPath: string;
}

let pending: CapturePendingSession | null = null;

export function setCapturePendingSession(s: CapturePendingSession): void {
  pending = s;
}

/** Read the pending session WITHOUT clearing it. The workspace
 *  consumes via `consumeCapturePendingSession` once it commits to
 *  starting a session. Tests can use this for assertions. */
export function peekCapturePendingSession(): CapturePendingSession | null {
  return pending;
}

/** Read + clear in one step. The workspace's mount path uses this
 *  so a subsequent direct navigation to `/capture` (e.g. browser
 *  back) sees the cleared state and surfaces the no-session hint. */
export function consumeCapturePendingSession(): CapturePendingSession | null {
  const s = pending;
  pending = null;
  return s;
}

/** Test/cleanup helper. */
export function clearCapturePendingSession(): void {
  pending = null;
}
