/**
 * Simple configuration modal for timed (interval) screen capture.
 * Returns { intervalSec, count } on confirm, or null on cancel.
 */

export type CursorMode = "always" | "motion" | "never";

export interface IntervalCaptureConfig {
  intervalSec: number;
  count: number;
  cursor: CursorMode;
}

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
    const overlay = document.createElement("div");
    overlay.className = "capture-dialog-overlay";

    const dialog = document.createElement("div");
    dialog.className = "capture-dialog";

    const title = document.createElement("div");
    title.className = "capture-dialog-title";
    title.textContent = "Timed screen capture";
    dialog.appendChild(title);

    const desc = document.createElement("div");
    desc.className = "capture-dialog-desc";
    desc.textContent = "You'll be asked to pick a screen/window once. Frames will be captured at the configured interval.";
    dialog.appendChild(desc);

    const mkField = (labelText: string, value: number, min: number, max: number) => {
      const row = document.createElement("label");
      row.className = "capture-dialog-row";
      const label = document.createElement("span");
      label.className = "capture-dialog-label";
      label.textContent = labelText;
      const input = document.createElement("input");
      input.type = "number";
      input.className = "capture-dialog-input";
      input.value = String(value);
      input.min = String(min);
      input.max = String(max);
      input.step = "1";
      row.appendChild(label);
      row.appendChild(input);
      return { row, input };
    };

    const { row: intervalRow, input: intervalInput } = mkField("Interval (seconds)", cfg.intervalSec, 1, 3600);
    const { row: countRow, input: countInput } = mkField("Frame count", cfg.count, 1, 1000);
    dialog.appendChild(intervalRow);
    dialog.appendChild(countRow);

    // Cursor selector
    const cursorRow = document.createElement("label");
    cursorRow.className = "capture-dialog-row";
    const cursorLabel = document.createElement("span");
    cursorLabel.className = "capture-dialog-label";
    cursorLabel.textContent = "Mouse cursor";
    const cursorSelect = document.createElement("select");
    cursorSelect.className = "capture-dialog-select";
    for (const [value, label] of [
      ["always", "Always show"],
      ["motion", "Only when moving"],
      ["never", "Hide"],
    ] as const) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (value === cfg.cursor) opt.selected = true;
      cursorSelect.appendChild(opt);
    }
    cursorRow.appendChild(cursorLabel);
    cursorRow.appendChild(cursorSelect);
    dialog.appendChild(cursorRow);

    const actions = document.createElement("div");
    actions.className = "capture-dialog-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "capture-dialog-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      close();
      resolve(null);
    });

    const okBtn = document.createElement("button");
    okBtn.className = "capture-dialog-btn capture-dialog-btn-primary";
    okBtn.textContent = "Start";
    okBtn.addEventListener("click", () => {
      const intervalSec = parseInt(intervalInput.value, 10);
      const count = parseInt(countInput.value, 10);
      const cursor = cursorSelect.value as CursorMode;
      if (!isFinite(intervalSec) || intervalSec <= 0 || !isFinite(count) || count <= 0) {
        intervalInput.focus();
        return;
      }
      close();
      resolve({ intervalSec, count, cursor });
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    dialog.appendChild(actions);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // ESC closes
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        resolve(null);
      } else if (e.key === "Enter" && (e.target === intervalInput || e.target === countInput)) {
        okBtn.click();
      }
    };
    document.addEventListener("keydown", onKey);

    const close = () => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };

    // Click outside closes
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        close();
        resolve(null);
      }
    });

    requestAnimationFrame(() => intervalInput.focus());
  });
}

/** Floating progress toast shown during interval capture. */
export interface ProgressToastHandle {
  update(current: number, total: number): void;
  complete(): void;
  setOnCancel(fn: () => void): void;
}

export function showIntervalCaptureProgress(total: number, onCancel?: () => void): ProgressToastHandle {
  const toast = document.createElement("div");
  toast.className = "capture-progress-toast";

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined capture-progress-icon";
  icon.textContent = "screenshot_monitor";
  toast.appendChild(icon);

  const text = document.createElement("span");
  text.className = "capture-progress-text";
  text.textContent = `Capturing 0 / ${total}...`;
  toast.appendChild(text);

  const bar = document.createElement("div");
  bar.className = "capture-progress-bar";
  const barFill = document.createElement("div");
  barFill.className = "capture-progress-bar-fill";
  bar.appendChild(barFill);
  toast.appendChild(bar);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "capture-progress-cancel";
  cancelBtn.textContent = "Cancel";
  let cancelHandler = onCancel;
  cancelBtn.addEventListener("click", () => cancelHandler?.());
  toast.appendChild(cancelBtn);

  document.body.appendChild(toast);

  return {
    update(current: number, total: number) {
      text.textContent = `Capturing ${current} / ${total}...`;
      barFill.style.width = `${Math.min(100, Math.round((current / total) * 100))}%`;
    },
    complete() {
      toast.remove();
    },
    setOnCancel(fn: () => void) {
      cancelHandler = fn;
    },
  };
}
