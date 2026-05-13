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
  };

  declare mode: CaptureMode;
  declare canCaptureOnce: boolean;

  constructor() {
    super();
    this.mode = "once";
    this.canCaptureOnce = true;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
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
        <button type="button" class="capture-toolbar-btn" disabled title="Available in Phase 4">
          Auto OFF
        </button>
        <button type="button" class="capture-toolbar-btn" disabled title="Coming soon">
          Capture Area
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
