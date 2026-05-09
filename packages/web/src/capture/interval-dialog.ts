/**
 * Promise / handle-shaped wrappers around the timed-capture UI
 * elements. The actual DOM lives in `<annot-interval-capture-dialog>`
 * and `<annot-capture-progress-toast>` (Lit Phase 6); this module
 * keeps the public function shape the rest of the capture
 * pipeline already calls.
 */

import "./annot-capture-progress-toast.js";
import type { AnnotCaptureProgressToastElement } from "./annot-capture-progress-toast.js";
import "./annot-interval-capture-dialog.js";
import type {
  AnnotIntervalCaptureDialogElement,
  IntervalCaptureConfirmDetail,
} from "./annot-interval-capture-dialog.js";

export type { CursorMode, IntervalCaptureConfig } from "./annot-interval-capture-dialog.js";

import type { CursorMode, IntervalCaptureConfig } from "./annot-interval-capture-dialog.js";

const CURSOR_PREF_KEY = "annot-capture-cursor";

/** Load the last-used cursor preference from localStorage, or default. */
export function loadCursorPreference(): CursorMode {
  const v = localStorage.getItem(CURSOR_PREF_KEY);
  return v === "motion" || v === "never" ? v : "always";
}

/** Persist the cursor preference for future captures. */
export function saveCursorPreference(cursor: CursorMode): void {
  localStorage.setItem(CURSOR_PREF_KEY, cursor);
}

/** Show a modal dialog asking for interval seconds, frame count, and cursor mode. */
export function showIntervalCaptureDialog(
  initial?: IntervalCaptureConfig,
): Promise<IntervalCaptureConfig | null> {
  const cfg: IntervalCaptureConfig = initial || {
    intervalSec: 10,
    count: 10,
    cursor: loadCursorPreference(),
  };
  return new Promise((resolve) => {
    const dlg: AnnotIntervalCaptureDialogElement = document.createElement(
      "annot-interval-capture-dialog",
    );
    dlg.intervalSec = cfg.intervalSec;
    dlg.frameCount = cfg.count;
    dlg.cursor = cfg.cursor;
    document.body.appendChild(dlg);

    const close = () => dlg.remove();
    dlg.addEventListener("capture-cancel", () => {
      close();
      resolve(null);
    });
    dlg.addEventListener("capture-confirm", (e: Event) => {
      const detail = (e as CustomEvent<IntervalCaptureConfirmDetail>).detail;
      close();
      resolve(detail.config);
    });
  });
}

/** Floating progress toast shown during interval capture. */
export interface ProgressToastHandle {
  update(current: number, total: number): void;
  complete(): void;
  setOnCancel(fn: () => void): void;
}

export function showIntervalCaptureProgress(
  total: number,
  onCancel?: () => void,
): ProgressToastHandle {
  const toast: AnnotCaptureProgressToastElement = document.createElement(
    "annot-capture-progress-toast",
  );
  toast.current = 0;
  toast.total = total;
  let cancelHandler = onCancel;
  toast.addEventListener("cancel-click", () => cancelHandler?.());
  document.body.appendChild(toast);

  return {
    update(current: number, totalArg: number) {
      toast.current = current;
      toast.total = totalArg;
    },
    complete() {
      toast.remove();
    },
    setOnCancel(fn: () => void) {
      cancelHandler = fn;
    },
  };
}
