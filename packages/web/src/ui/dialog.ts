/**
 * Lightweight modal dialogs to replace the browser's native
 * `prompt()` / `confirm()` / `alert()`. Matches the Annot design language
 * (dark panel, accent buttons, Esc/outside-click to close).
 */

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

export interface ConfirmOptions extends DialogCommonOptions {}
export interface AlertOptions extends Omit<DialogCommonOptions, "cancelLabel" | "danger"> {}

/** Prompt for a single text value. Resolves with the string, or null if cancelled. */
export function showPromptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const { close, root, body } = openDialog(opts.title, opts.message);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "app-dialog-input";
    input.value = opts.defaultValue ?? "";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.setAttribute("aria-label", opts.title);
    body.appendChild(input);

    const errEl = document.createElement("div");
    errEl.className = "app-dialog-error";
    errEl.style.display = "none";
    body.appendChild(errEl);

    const showError = (msg: string) => {
      errEl.textContent = msg;
      errEl.style.display = "";
      input.setAttribute("aria-invalid", "true");
      input.focus();
      input.select();
    };

    addActions(root, {
      okLabel: opts.okLabel ?? "OK",
      cancelLabel: opts.cancelLabel ?? "Cancel",
      danger: opts.danger,
      onCancel: () => {
        close();
        resolve(null);
      },
      onOk: () => {
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
      },
    });

    // Focus and select the existing value for easy replacement
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        root.querySelector<HTMLButtonElement>(".app-dialog-ok")?.click();
      }
    });

    attachCloseBehaviors(
      root,
      () => {
        close();
        resolve(null);
      },
      { clickOutside: false },
    );
  });
}

/** Yes/No confirmation. Resolves true if confirmed, false otherwise. */
export function showConfirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const { close, root } = openDialog(opts.title, opts.message);
    addActions(root, {
      okLabel: opts.okLabel ?? "OK",
      cancelLabel: opts.cancelLabel ?? "Cancel",
      danger: opts.danger,
      onCancel: () => {
        close();
        resolve(false);
      },
      onOk: () => {
        close();
        resolve(true);
      },
    });
    requestAnimationFrame(() => {
      root.querySelector<HTMLButtonElement>(".app-dialog-ok")?.focus();
    });
    attachCloseBehaviors(
      root,
      () => {
        close();
        resolve(false);
      },
      { clickOutside: true },
    );
  });
}

/** Informational message (e.g., error). Resolves when dismissed. */
export function showAlertDialog(opts: AlertOptions): Promise<void> {
  return new Promise((resolve) => {
    const { close, root } = openDialog(opts.title, opts.message);
    addActions(root, {
      okLabel: opts.okLabel ?? "OK",
      onCancel: () => {
        close();
        resolve();
      },
      onOk: () => {
        close();
        resolve();
      },
      singleButton: true,
    });
    requestAnimationFrame(() => {
      root.querySelector<HTMLButtonElement>(".app-dialog-ok")?.focus();
    });
    attachCloseBehaviors(
      root,
      () => {
        close();
        resolve();
      },
      { clickOutside: true },
    );
  });
}

// ---- Internals ----

interface OpenedDialog {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

function openDialog(title: string, message?: string): OpenedDialog {
  const overlay = document.createElement("div");
  overlay.className = "app-dialog-overlay";

  const dialog = document.createElement("div");
  dialog.className = "app-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", title);

  const titleEl = document.createElement("div");
  titleEl.className = "app-dialog-title";
  titleEl.textContent = title;
  dialog.appendChild(titleEl);

  if (message) {
    const msgEl = document.createElement("div");
    msgEl.className = "app-dialog-message";
    msgEl.textContent = message;
    dialog.appendChild(msgEl);
  }

  const body = document.createElement("div");
  body.className = "app-dialog-body";
  dialog.appendChild(body);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const close = () => {
    try {
      overlay.remove();
    } catch {
      /* ignore */
    }
  };

  return { root: dialog, body, close };
}

interface ActionOpts {
  okLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  singleButton?: boolean;
  onOk: () => void;
  onCancel: () => void;
}

function addActions(root: HTMLElement, opts: ActionOpts): void {
  const actions = document.createElement("div");
  actions.className = "app-dialog-actions";

  if (!opts.singleButton) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "app-dialog-btn app-dialog-cancel";
    cancel.textContent = opts.cancelLabel ?? "Cancel";
    cancel.addEventListener("click", () => opts.onCancel());
    actions.appendChild(cancel);
  }

  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = `app-dialog-btn app-dialog-ok${opts.danger ? " app-dialog-danger" : " app-dialog-primary"}`;
  ok.textContent = opts.okLabel;
  ok.addEventListener("click", () => opts.onOk());
  actions.appendChild(ok);

  root.appendChild(actions);
}

function attachCloseBehaviors(
  root: HTMLElement,
  onCancel: () => void,
  opts: { clickOutside: boolean },
): void {
  const overlay = root.parentElement as HTMLElement;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      document.removeEventListener("keydown", onKey);
      onCancel();
    }
  };
  document.addEventListener("keydown", onKey);

  if (opts.clickOutside) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        document.removeEventListener("keydown", onKey);
        onCancel();
      }
    });
  }
}
