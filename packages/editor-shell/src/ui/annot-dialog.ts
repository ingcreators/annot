/**
 * `<annot-dialog>` — modal-dialog chrome (overlay + panel + title +
 * optional message + body slot + actions row).
 *
 * Lit Phase 6 — replaces the imperative `openDialog` /
 * `addActions` / `attachCloseBehaviors` triplet inside
 * `dialog.ts`. The functional API (`showPromptDialog` /
 * `showConfirmDialog` / `showAlertDialog`) is preserved as
 * Promise-based one-shot helpers — they construct the element,
 * mount it, and resolve when the user clicks OK/Cancel/Esc.
 *
 * The element is purely presentational: it owns the chrome,
 * fires `dialog-ok` / `dialog-cancel` events, and exposes a
 * default `<slot>` for the body (input + error label for
 * prompt, custom content for capture-config dialog, etc.).
 */

import { html, LitElement, nothing } from "../lit.js";

export class AnnotDialogElement extends LitElement {
  static override properties = {
    title: { type: String },
    message: { type: String },
    okLabel: { type: String },
    cancelLabel: { type: String },
    danger: { type: Boolean },
    singleButton: { type: Boolean },
    closeOnOutsideClick: { type: Boolean },
  };

  declare title: string;
  declare message: string;
  declare okLabel: string;
  declare cancelLabel: string;
  declare danger: boolean;
  declare singleButton: boolean;
  declare closeOnOutsideClick: boolean;

  /** Set to true when Esc has been pressed; the orchestrator
   *  clears the keydown listener on disconnect so this flag is
   *  only ever consulted by the dispatch path. */
  #escListenerInstalled = false;
  #onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.#dispatchCancel();
    }
  };

  constructor() {
    super();
    this.title = "";
    this.message = "";
    this.okLabel = "OK";
    this.cancelLabel = "Cancel";
    this.danger = false;
    this.singleButton = false;
    this.closeOnOutsideClick = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.#escListenerInstalled) {
      document.addEventListener("keydown", this.#onKeydown);
      this.#escListenerInstalled = true;
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#escListenerInstalled) {
      document.removeEventListener("keydown", this.#onKeydown);
      this.#escListenerInstalled = false;
    }
  }

  override render() {
    return html`
      <div
        class="app-dialog-overlay"
        @click=${(e: MouseEvent) => {
          if (this.closeOnOutsideClick && e.target === e.currentTarget) {
            this.#dispatchCancel();
          }
        }}
      >
        <div class="app-dialog" role="dialog" aria-modal="true" aria-label=${this.title}>
          <div class="app-dialog-title">${this.title}</div>
          ${this.message
            ? html`<div class="app-dialog-message">${this.message}</div>`
            : nothing}
          <div class="app-dialog-body">
            <slot></slot>
          </div>
          <div class="app-dialog-actions">
            ${this.singleButton
              ? nothing
              : html`<button
                  type="button"
                  class="app-dialog-btn app-dialog-cancel"
                  @click=${this.#dispatchCancel}
                >
                  ${this.cancelLabel}
                </button>`}
            <button
              type="button"
              class=${this.danger
                ? "app-dialog-btn app-dialog-ok app-dialog-danger"
                : "app-dialog-btn app-dialog-ok app-dialog-primary"}
              @click=${this.#dispatchOk}
            >
              ${this.okLabel}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /** Light-DOM `<slot>` doesn't relocate children — but since the
   *  element renders to light DOM, native `<slot>` won't work
   *  declaratively. Pre-existing children appended before mount
   *  (e.g. the prompt's `<input>` + error `<div>`) end up as
   *  direct siblings of the rendered overlay, NOT inside the
   *  body. After the first update we relocate those orphaned
   *  children into `.app-dialog-body`, replacing the `<slot>`
   *  placeholder. Subsequent imperative additions to the body are
   *  also accepted (consumers query `.app-dialog-body` directly). */
  protected override firstUpdated(): void {
    const body = this.querySelector<HTMLElement>(".app-dialog-body");
    const overlay = this.querySelector<HTMLElement>(".app-dialog-overlay");
    if (!body || !overlay) return;
    const slot = body.querySelector("slot");
    // Direct element children of `this` other than the rendered
    // overlay are pre-slotted body content — move them in front of
    // the slot placeholder, preserving document order.
    for (const child of Array.from(this.children)) {
      if (child === overlay) continue;
      body.insertBefore(child, slot);
    }
    slot?.remove();
  }

  /** Convenience accessor for orchestrators that want to inject
   *  body content (e.g. the prompt input). */
  getBody(): HTMLElement | null {
    return this.querySelector<HTMLElement>(".app-dialog-body");
  }

  /** Programmatic focus helper — orchestrators call this after
   *  mount so the OK button gets focus for confirm / alert. */
  focusOk(): void {
    const ok = this.querySelector<HTMLButtonElement>(".app-dialog-ok");
    ok?.focus();
  }

  #dispatchOk = (): void => {
    this.dispatchEvent(new CustomEvent("dialog-ok", { bubbles: true }));
  };

  #dispatchCancel = (): void => {
    this.dispatchEvent(new CustomEvent("dialog-cancel", { bubbles: true }));
  };
}

if (!customElements.get("annot-dialog")) {
  customElements.define("annot-dialog", AnnotDialogElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-dialog": AnnotDialogElement;
  }
}
