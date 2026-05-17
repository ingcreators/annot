/**
 * Lightweight modal dialogs to replace the browser's native
 * `prompt()` / `confirm()` / `alert()`. Matches the Annot design
 * language (dark panel, accent buttons, Esc/outside-click to close).
 *
 * Lit Phase 6 — internals were imperative DOM builders; they now
 * mount an `<annot-dialog>` Lit element and listen for its
 * `dialog-ok` / `dialog-cancel` events. The Promise-based
 * functional API is unchanged so the 30+ callers don't move.
 */

import "./annot-dialog.js";

interface DialogCommonOptions {
  title: string;
  /** Optional supporting description under the title. */
  message?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** If true, the OK/confirm button is styled as a destructive action. */
  danger?: boolean;
}

export interface PromptOptions extends DialogCommonOptions {
  defaultValue?: string;
  placeholder?: string;
  /** Validates the input. Return a non-empty string to block submit with an inline error. */
  validate?: (value: string) => string | null | undefined;
}

export type ConfirmOptions = DialogCommonOptions;
export type AlertOptions = Omit<DialogCommonOptions, "cancelLabel" | "danger">;

/** Prompt for a single text value. Resolves with the string, or null if cancelled. */
export function showPromptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement("annot-dialog");
    dlg.title = opts.title;
    if (opts.message) dlg.message = opts.message;
    dlg.okLabel = opts.okLabel ?? "OK";
    dlg.cancelLabel = opts.cancelLabel ?? "Cancel";
    if (opts.danger) dlg.danger = true;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "app-dialog-input";
    input.value = opts.defaultValue ?? "";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.setAttribute("aria-label", opts.title);

    const errEl = document.createElement("div");
    errEl.className = "app-dialog-error";
    errEl.style.display = "none";

    // Pre-slot the prompt body content. `firstUpdated` strips the
    // `<slot>` placeholder, leaving the input + error div as
    // direct children of `.app-dialog-body`.
    dlg.appendChild(input);
    dlg.appendChild(errEl);
    document.body.appendChild(dlg);

    const showError = (msg: string) => {
      errEl.textContent = msg;
      errEl.style.display = "";
      input.setAttribute("aria-invalid", "true");
      input.focus();
      input.select();
    };

    const close = () => dlg.remove();

    dlg.addEventListener("dialog-cancel", () => {
      close();
      resolve(null);
    });
    dlg.addEventListener("dialog-ok", () => {
      const v = input.value.trim();
      if (!v) {
        showError("Please enter a value.");
        return;
      }
      if (opts.validate) {
        const err = opts.validate(v);
        if (err) {
          showError(err);
          return;
        }
      }
      close();
      resolve(v);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        dlg.querySelector<HTMLButtonElement>(".app-dialog-ok")?.click();
      }
    });

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

/** Yes/No confirmation. Resolves true if confirmed, false otherwise. */
export function showConfirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = document.createElement("annot-dialog");
    dlg.title = opts.title;
    if (opts.message) dlg.message = opts.message;
    dlg.okLabel = opts.okLabel ?? "OK";
    dlg.cancelLabel = opts.cancelLabel ?? "Cancel";
    if (opts.danger) dlg.danger = true;
    dlg.closeOnOutsideClick = true;
    document.body.appendChild(dlg);

    const close = () => dlg.remove();
    dlg.addEventListener("dialog-cancel", () => {
      close();
      resolve(false);
    });
    dlg.addEventListener("dialog-ok", () => {
      close();
      resolve(true);
    });

    requestAnimationFrame(() => dlg.focusOk());
  });
}

/**
 * Explorer-style "file already exists" prompt with three actions —
 * Replace / Keep both / Skip — plus an optional "Apply to all
 * remaining conflicts" checkbox for batch flows. Cancel (overlay
 * click / Esc / X) returns `{ action: "cancel" }` so the caller
 * can abort the batch entirely.
 *
 * Unlike `showConfirmDialog` this dialog has its own DOM rather
 * than going through `<annot-dialog>` — that element's actions
 * row is fixed at ok+cancel, and the conflict prompt needs three
 * non-destructive choices side-by-side.
 */
export type FileConflictAction = "replace" | "keepBoth" | "skip" | "cancel";

export interface FileConflictDialogOptions {
  /** Leaf filename, e.g. `"screenshot.png"`. Shown verbatim in
   *  the title — the dialog does no truncation. */
  filename: string;
  /** Human-readable destination, e.g. `"Browser / Screenshots"`.
   *  Shown in the body line so the user knows WHERE the
   *  collision is. */
  destinationLabel: string;
  /** Show the "Apply to all remaining" checkbox. Pass `false`
   *  when this is the only conflict (e.g. single-file picker
   *  pick) so the checkbox doesn't render as dead UI. */
  showApplyToAll?: boolean;
}

export interface FileConflictResult {
  action: FileConflictAction;
  applyToAll: boolean;
}

export function showFileConflictDialog(
  opts: FileConflictDialogOptions,
): Promise<FileConflictResult> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "app-dialog-overlay";

    const dialog = document.createElement("div");
    dialog.className = "app-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", `${opts.filename} already exists`);

    const title = document.createElement("div");
    title.className = "app-dialog-title";
    title.textContent = `"${opts.filename}" already exists`;
    dialog.appendChild(title);

    const message = document.createElement("div");
    message.className = "app-dialog-message";
    message.textContent = `A file with that name already exists in ${opts.destinationLabel}.`;
    dialog.appendChild(message);

    let applyToAllInput: HTMLInputElement | null = null;
    if (opts.showApplyToAll) {
      const body = document.createElement("div");
      body.className = "app-dialog-body";
      const row = document.createElement("label");
      row.className = "app-dialog-checkbox-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "app-dialog-apply-to-all";
      const text = document.createElement("span");
      text.textContent = "Apply to all remaining conflicts";
      row.appendChild(cb);
      row.appendChild(text);
      body.appendChild(row);
      dialog.appendChild(body);
      applyToAllInput = cb;
    }

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions app-dialog-actions-stack";

    const settle = (action: FileConflictAction) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve({ action, applyToAll: applyToAllInput?.checked ?? false });
    };

    const mkBtn = (label: string, cls: string, action: FileConflictAction): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `app-dialog-btn ${cls}`;
      btn.textContent = label;
      btn.addEventListener("click", () => settle(action));
      return btn;
    };

    // Order matches Explorer's: Replace first (primary), Keep
    // Both, Skip, then a secondary Cancel that aborts the batch.
    actions.appendChild(mkBtn("Replace", "app-dialog-ok app-dialog-danger", "replace"));
    actions.appendChild(mkBtn("Keep both", "app-dialog-ok app-dialog-primary", "keepBoth"));
    actions.appendChild(mkBtn("Skip", "app-dialog-cancel", "skip"));
    actions.appendChild(mkBtn("Cancel", "app-dialog-cancel", "cancel"));
    dialog.appendChild(actions);

    overlay.appendChild(dialog);
    overlay.addEventListener("click", (e) => {
      // Outside-click counts as Cancel — same semantics as Esc.
      if (e.target === overlay) settle("cancel");
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        settle("cancel");
      }
    };
    document.addEventListener("keydown", onKey);

    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      dialog.querySelector<HTMLButtonElement>(".app-dialog-ok.app-dialog-primary")?.focus();
    });
  });
}

/** Informational message (e.g., error). Resolves when dismissed. */
export function showAlertDialog(opts: AlertOptions): Promise<void> {
  return new Promise((resolve) => {
    const dlg = document.createElement("annot-dialog");
    dlg.title = opts.title;
    if (opts.message) dlg.message = opts.message;
    dlg.okLabel = opts.okLabel ?? "OK";
    dlg.singleButton = true;
    dlg.closeOnOutsideClick = true;
    document.body.appendChild(dlg);

    const close = () => dlg.remove();
    const dismiss = () => {
      close();
      resolve();
    };
    dlg.addEventListener("dialog-cancel", dismiss);
    dlg.addEventListener("dialog-ok", dismiss);

    requestAnimationFrame(() => dlg.focusOk());
  });
}
