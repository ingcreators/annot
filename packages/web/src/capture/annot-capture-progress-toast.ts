/**
 * `<annot-capture-progress-toast>` — floating progress indicator
 * shown during interval capture. Renders a screenshot icon, the
 * "Capturing N / M..." label, a progress bar, and a Cancel
 * button.
 *
 * Lit Phase 6 — replaces the imperative DOM-builder closure
 * inside `showIntervalCaptureProgress` (`interval-dialog.ts`).
 * The Promise-shaped `ProgressToastHandle` (update / complete /
 * setOnCancel) is preserved on the orchestrator side; the
 * element exposes property setters + a `cancel-click` event.
 */

import { html, LitElement } from "../lit.js";

export class AnnotCaptureProgressToastElement extends LitElement {
  static override properties = {
    current: { type: Number },
    total: { type: Number },
  };

  declare current: number;
  declare total: number;

  constructor() {
    super();
    this.current = 0;
    this.total = 0;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("capture-progress-toast");
  }

  override render() {
    const pct = this.total > 0 ? Math.min(100, Math.round((this.current / this.total) * 100)) : 0;
    return html`
      <span class="material-symbols-outlined capture-progress-icon">screenshot_monitor</span>
      <span class="capture-progress-text">Capturing ${this.current} / ${this.total}\u2026</span>
      <div class="capture-progress-bar">
        <div class="capture-progress-bar-fill" style="width: ${pct}%"></div>
      </div>
      <button
        type="button"
        class="capture-progress-cancel"
        @click=${this.#cancel}
      >
        Cancel
      </button>
    `;
  }

  #cancel = (): void => {
    this.dispatchEvent(new CustomEvent("cancel-click", { bubbles: true }));
  };
}

if (!customElements.get("annot-capture-progress-toast")) {
  customElements.define(
    "annot-capture-progress-toast",
    AnnotCaptureProgressToastElement,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-capture-progress-toast": AnnotCaptureProgressToastElement;
  }
}
