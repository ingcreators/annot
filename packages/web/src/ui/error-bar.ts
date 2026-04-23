/**
 * Persistent error bar displayed below the toolbar.
 * Similar to draw.io's save error indicator.
 */

let barEl: HTMLElement | null = null;
let hideTimer: number | undefined;

function ensureBar(): HTMLElement {
  if (barEl) return barEl;
  barEl = document.createElement("div");
  barEl.className = "error-bar";
  barEl.style.display = "none";

  // Insert after toolbar
  const toolbar = document.getElementById("toolbar");
  if (toolbar?.nextSibling) {
    toolbar.parentElement!.insertBefore(barEl, toolbar.nextSibling);
  } else {
    document.body.prepend(barEl);
  }

  return barEl;
}

export type ErrorSeverity = "error" | "warning" | "info";

export interface ErrorBarOptions {
  message: string;
  severity?: ErrorSeverity;
  action?: { label: string; onClick: () => void };
  autoDismiss?: number; // ms, 0 = manual dismiss only
  /** Called when the user dismisses the bar (either via the ✕ button
   *  or when `autoDismiss` elapses). Lets callers release any
   *  pending promises they were resolving on the action click. */
  onDismiss?: () => void;
}

/** Show error/warning bar below toolbar. */
export function showError(opts: ErrorBarOptions): void {
  const bar = ensureBar();
  clearTimeout(hideTimer);

  bar.className = `error-bar error-bar-${opts.severity || "error"}`;
  bar.innerHTML = "";

  // Icon
  const icon = document.createElement("span");
  icon.className = "error-bar-icon material-symbols-outlined";
  icon.textContent = opts.severity === "warning" ? "warning"
    : opts.severity === "info" ? "info" : "error";
  bar.appendChild(icon);

  // Message
  const msg = document.createElement("span");
  msg.className = "error-bar-message";
  msg.textContent = opts.message;
  bar.appendChild(msg);

  // Action button
  if (opts.action) {
    const btn = document.createElement("button");
    btn.className = "error-bar-action";
    btn.textContent = opts.action.label;
    btn.addEventListener("click", opts.action.onClick);
    bar.appendChild(btn);
  }

  // Dismiss button
  const onDismiss = opts.onDismiss;
  const dismiss = document.createElement("button");
  dismiss.className = "error-bar-dismiss";
  dismiss.textContent = "\u00d7";
  dismiss.addEventListener("click", () => {
    hideError();
    onDismiss?.();
  });
  bar.appendChild(dismiss);

  bar.style.display = "flex";

  if (opts.autoDismiss && opts.autoDismiss > 0) {
    hideTimer = window.setTimeout(() => {
      hideError();
      onDismiss?.();
    }, opts.autoDismiss);
  }
}

/** Hide the error bar. */
export function hideError(): void {
  if (barEl) barEl.style.display = "none";
  clearTimeout(hideTimer);
}

/** Convenience: show a save error with retry. */
export function showSaveError(message: string, onRetry?: () => void): void {
  showError({
    message,
    severity: "error",
    action: onRetry ? { label: "Retry", onClick: onRetry } : undefined,
  });
}

/** Convenience: show token expired with re-login action. */
export function showAuthError(onReLogin: () => void, onDismiss?: () => void): void {
  showError({
    message: "Session expired. Please sign in again.",
    severity: "warning",
    action: { label: "Sign in", onClick: onReLogin },
    onDismiss,
  });
}

/** Convenience: show a transient info message. */
export function showInfo(message: string, durationMs = 5000): void {
  showError({ message, severity: "info", autoDismiss: durationMs });
}
