/**
 * Persistent error bar displayed below the toolbar, similar to
 * draw.io's save error indicator.
 *
 * Two surfaces live in this module:
 *
 *  1. The `<annot-error-bar>` Lit element — a declarative component
 *     that renders an icon + message + optional retry action +
 *     dismiss button with the severity-coloured chrome.
 *  2. The module-level functional API (`showError`, `hideError`,
 *     `showSaveError`, `showAuthError`, `showInfo`) — a tiny facade
 *     over a singleton `<annot-error-bar>` instance. Calling the
 *     functions mutates the singleton; no caller needs to manage
 *     the element lifetime.
 *
 * Lit Phase 0 — replaces the imperative DOM construction that used
 * to live inline in `showError`. The functional API is unchanged so
 * the 8+ callers don't move.
 *
 * Uses Lit's `static properties` runtime API instead of field
 * decorators: the TC39 `accessor` keyword the decorator form requires
 * is left intact by Vite 8's oxc transformer, which Node 24 can't
 * parse. The runtime API is spec-stable and decorator-toolchain-
 * independent.
 */

import { html, LitElement, nothing } from "../lit.js";

export type ErrorSeverity = "error" | "warning" | "info";

interface ActionSpec {
  label: string;
  onClick: () => void;
}

export class AnnotErrorBarElement extends LitElement {
  static override properties = {
    severity: { type: String },
    message: { type: String },
    action: { attribute: false },
    visible: { type: Boolean },
    onDismissClick: { attribute: false },
  };

  // `declare` is type-only (no runtime class-field emit), so Lit's
  // `createProperty` can install its reactive getter/setter on the
  // prototype without a class-field initializer shadowing it.
  declare severity: ErrorSeverity;
  declare message: string;
  declare action: ActionSpec | null;
  declare visible: boolean;
  /** Fired when the user clicks the dismiss button. The module-level
   *  `showError` wires this to `hideError` + the caller's opt-in
   *  `onDismiss` so timer cleanup is centralised in one place. */
  declare onDismissClick: (() => void) | null;

  constructor() {
    super();
    this.severity = "error";
    this.message = "";
    this.action = null;
    this.visible = false;
    this.onDismissClick = null;
  }

  // Light DOM so the existing `.error-bar` / `.error-bar-*` rules in
  // `app.css` apply unchanged (hybrid-CSS approach per
  // `docs/plans/lit-migration.md`).
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    if (!this.visible) return nothing;
    const iconName =
      this.severity === "warning" ? "warning" : this.severity === "info" ? "info" : "error";
    return html`
      <span class="error-bar-icon material-symbols-outlined">${iconName}</span>
      <span class="error-bar-message">${this.message}</span>
      ${this.action
        ? html`<button
            type="button"
            class="error-bar-action"
            @click=${this.action.onClick}
          >
            ${this.action.label}
          </button>`
        : nothing}
      <button
        type="button"
        class="error-bar-dismiss"
        aria-label="Dismiss"
        @click=${this.#dismiss}
      >
        \u00d7
      </button>
    `;
  }

  protected override updated(): void {
    this.className = this.visible ? `error-bar error-bar-${this.severity}` : "error-bar";
    this.style.display = this.visible ? "flex" : "none";
  }

  #dismiss = (): void => {
    this.onDismissClick?.();
  };
}

if (!customElements.get("annot-error-bar")) {
  customElements.define("annot-error-bar", AnnotErrorBarElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-error-bar": AnnotErrorBarElement;
  }
}

// ---- Singleton + functional API ----

let barEl: AnnotErrorBarElement | null = null;
let hideTimer: number | undefined;

function ensureBar(): AnnotErrorBarElement {
  if (barEl) return barEl;
  barEl = document.createElement("annot-error-bar");

  // Insert after toolbar
  const toolbar = document.getElementById("toolbar");
  if (toolbar?.nextSibling) {
    toolbar.parentElement!.insertBefore(barEl, toolbar.nextSibling);
  } else {
    document.body.prepend(barEl);
  }

  return barEl;
}

export interface ErrorBarOptions {
  message: string;
  severity?: ErrorSeverity;
  action?: ActionSpec;
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
  bar.severity = opts.severity || "error";
  bar.message = opts.message;
  bar.action = opts.action ?? null;
  bar.onDismissClick = () => {
    hideError();
    opts.onDismiss?.();
  };
  bar.visible = true;

  if (opts.autoDismiss && opts.autoDismiss > 0) {
    hideTimer = window.setTimeout(() => {
      hideError();
      opts.onDismiss?.();
    }, opts.autoDismiss);
  }
}

/** Hide the error bar. */
export function hideError(): void {
  if (barEl) barEl.visible = false;
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
export function showAuthError(
  onReLogin: () => void,
  onDismiss?: () => void,
  opts: { provider?: string } = {},
): void {
  const label = opts.provider ? `${opts.provider} session expired.` : "Session expired.";
  showError({
    message: `${label} Please sign in again.`,
    severity: "warning",
    action: { label: "Sign in", onClick: onReLogin },
    onDismiss,
  });
}

/** Convenience: show a transient info message. */
export function showInfo(message: string, durationMs = 5000): void {
  showError({ message, severity: "info", autoDismiss: durationMs });
}
