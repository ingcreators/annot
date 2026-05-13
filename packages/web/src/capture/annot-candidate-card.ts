/**
 * `<annot-candidate-card>` — single capture card inside
 * `<annot-candidate-panel>`. Renders thumbnail + timestamp +
 * Delete button.
 *
 * Post-rollout cleanup: the original Phase 3 design buffered an
 * unsaved Blob and exposed Accept / Edit / Delete to gate
 * persistence. Real usage showed the Accept step was friction +
 * the buffer leaked memory at 4K, so the model flipped — every
 * capture persists immediately, the card is just a view onto the
 * already-saved record, and Delete actually deletes from
 * storage. Accept (and the earlier Edit shortcut) are gone.
 *
 * Lit Phase 6 — light DOM, `static properties`, no decorators.
 */

import { html, LitElement } from "../lit.js";
import type { CaptureCandidate } from "./types.js";

export class AnnotCandidateCardElement extends LitElement {
  static override properties = {
    candidate: { attribute: false },
  };

  declare candidate: CaptureCandidate;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    const c = this.candidate;
    if (!c) return html``;
    const time = formatTime(c.createdAt);
    return html`
      <div class="candidate-card" data-candidate-id=${c.id}>
        <div class="candidate-card-thumb">
          ${
            c.thumbnailDataUrl
              ? html`<img alt="capture thumbnail" src=${c.thumbnailDataUrl} />`
              : html`<div class="candidate-card-thumb-placeholder">no preview</div>`
          }
        </div>
        <div class="candidate-card-body">
          <div class="candidate-card-meta">
            <span class="candidate-card-time">${time}</span>
          </div>
          <div class="candidate-card-actions">
            <button
              type="button"
              class="candidate-card-btn candidate-card-btn-danger"
              @click=${() => this.#emit("candidate-delete")}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }

  #emit(name: "candidate-delete"): void {
    this.dispatchEvent(
      new CustomEvent(name, { bubbles: true, detail: { id: this.candidate?.id } }),
    );
  }
}

function formatTime(iso: string): string {
  // Show HH:MM:SS in local time; falls back to the raw ISO string
  // if parsing fails (older candidates from a future schema bump,
  // etc.).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}

if (!customElements.get("annot-candidate-card")) {
  customElements.define("annot-candidate-card", AnnotCandidateCardElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-candidate-card": AnnotCandidateCardElement;
  }
}
