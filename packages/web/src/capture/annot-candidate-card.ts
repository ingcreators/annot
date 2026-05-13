/**
 * `<annot-candidate-card>` — single capture candidate row inside
 * `<annot-candidate-panel>`. Renders thumbnail + timestamp + status
 * + Accept / Delete buttons.
 *
 * Phase 3 of `docs/plans/web-capture-redesign.md`, with the Edit
 * shortcut retired in the follow-up cleanup PR — the "Accept +
 * open editor" flow didn't survive contact with real usage, so
 * the card now offers only Accept (save without leaving the
 * workspace) and Delete. Users can open any saved capture in the
 * editor from the gallery after they leave the workspace.
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
            ${
              c.status === "accepted"
                ? html`<span class="candidate-card-status candidate-card-status-accepted"
                    >Accepted</span
                  >`
                : null
            }
          </div>
          <div class="candidate-card-actions">
            <button
              type="button"
              class="candidate-card-btn candidate-card-btn-primary"
              ?disabled=${c.status === "accepted"}
              @click=${() => this.#emit("candidate-accept")}
            >
              Accept
            </button>
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

  #emit(name: "candidate-accept" | "candidate-delete"): void {
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
