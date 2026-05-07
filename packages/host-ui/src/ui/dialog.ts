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
