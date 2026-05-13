/**
 * `<annot-candidate-panel>` — right-side list of capture candidates
 * inside the workspace.
 *
 * Phase 2 of `docs/plans/web-capture-redesign.md` ships only the
 * empty-state. Phase 3 adds the `CandidateStore` integration +
 * `<annot-candidate-card>` rows; Phase 4 starts populating it from
 * `AutoCaptureEngine`.
 */

import { html, LitElement } from "../lit.js";

export class AnnotCandidatePanelElement extends LitElement {
  static override properties = {
    count: { type: Number },
  };

  declare count: number;

  constructor() {
    super();
    this.count = 0;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    return html`
      <div class="candidate-panel">
        <div class="candidate-panel-header">Candidates (${this.count})</div>
        <div class="candidate-panel-body">
          ${
            this.count === 0
              ? html`<div class="candidate-panel-empty">
                No candidates yet.
                <div class="candidate-panel-empty-sub">
                  Auto Capture lands in Phase 4. For now, use the toolbar's
                  <strong>Capture Once</strong> button to save individual frames.
                </div>
              </div>`
              : html`<div class="candidate-panel-placeholder">
                Phase 3 will render candidate cards here.
              </div>`
          }
        </div>
      </div>
    `;
  }
}

if (!customElements.get("annot-candidate-panel")) {
  customElements.define("annot-candidate-panel", AnnotCandidatePanelElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-candidate-panel": AnnotCandidatePanelElement;
  }
}
