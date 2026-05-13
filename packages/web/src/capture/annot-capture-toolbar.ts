/**
 * `<annot-capture-toolbar>` — bottom button bar inside the capture
 * workspace's preview area. Phase 2 wires only `Capture Once`; the
 * other entries render disabled with a "Coming soon" hint.
 *
 * Lit Phase 6 — light DOM, `static properties`, no decorators.
 */

import { html, LitElement } from "../lit.js";
import type { CaptureMode } from "./types.js";

export class AnnotCaptureToolbarElement extends LitElement {
  static override properties = {
    mode: { type: String },
    canCaptureOnce: { type: Boolean },
    autoEnabled: { type: Boolean },
    autoSupported: { type: Boolean },
  };

  declare mode: CaptureMode;
  declare canCaptureOnce: boolean;
  declare autoEnabled: boolean;
  declare autoSupported: boolean;

  constructor() {
    super();
    this.mode = "once";
    this.canCaptureOnce = true;
    this.autoEnabled = false;
    this.autoSupported = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    const autoLabel = this.autoEnabled ? "Auto ON" : "Auto OFF";
    return html`
      <div class="capture-toolbar">
        <button
          type="button"
          class="capture-toolbar-btn capture-toolbar-btn-primary"
          ?disabled=${!this.canCaptureOnce}
          @click=${this.#capture}
        >
          Capture Once
        </button>
        <button
          type="button"
          class="capture-toolbar-btn"
          ?disabled=${!this.autoSupported}
          @click=${this.#toggleAuto}
          title=${
            this.autoSupported
              ? this.autoEnabled
                ? "Pause Auto Capture"
                : "Resume Auto Capture"
              : "Pick Auto Capture in the dialog to enable"
          }
        >
          ${autoLabel}
        </button>
        <span class="capture-toolbar-spacer"></span>
        <button
          type="button"
          class="capture-toolbar-btn capture-toolbar-btn-stop"
          @click=${this.#stop}
        >
          Stop
        </button>
      </div>
    `;
  }

  #capture = (): void => {
    this.dispatchEvent(new CustomEvent("capture-once-click", { bubbles: true }));
  };

  #toggleAuto = (): void => {
    if (!this.autoSupported) return;
    this.dispatchEvent(new CustomEvent("auto-toggle-click", { bubbles: true }));
  };

  #stop = (): void => {
    this.dispatchEvent(new CustomEvent("stop-click", { bubbles: true }));
  };
}

if (!customElements.get("annot-capture-toolbar")) {
  customElements.define("annot-capture-toolbar", AnnotCaptureToolbarElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-capture-toolbar": AnnotCaptureToolbarElement;
  }
}
