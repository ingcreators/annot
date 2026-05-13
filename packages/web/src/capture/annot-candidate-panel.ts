/**
 * `<annot-candidate-panel>` — right-side list of capture candidates
 * inside the workspace.
 *
 * Phase 3 of `docs/plans/web-capture-redesign.md`. Wires the
 * `CandidateStore` so the panel re-renders on every store
 * mutation; the workspace passes the store in via the `.store`
 * prop. Phase 2's empty-state survives intact for the
 * "no store / count === 0" path.
 *
 * Action events bubble up through the cards; the panel
 * re-dispatches them with the same name so the workspace can
 * listen at the panel boundary instead of every card.
 */

import { html, LitElement, nothing } from "../lit.js";
import "./annot-candidate-card.js";
import type { CandidateStore } from "./candidate-store.js";

export class AnnotCandidatePanelElement extends LitElement {
  static override properties = {
    store: { attribute: false },
    revision: { state: true },
  };

  declare store: CandidateStore | null;
  declare revision: number;

  /** Increments on every store `change` event so Lit re-renders
   *  even though the store reference itself doesn't change. */
  #onStoreChange = (): void => {
    this.revision = this.revision + 1;
  };

  constructor() {
    super();
    this.store = null;
    this.revision = 0;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.store?.addEventListener("change", this.#onStoreChange);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.store?.removeEventListener("change", this.#onStoreChange);
  }

  /** Re-bind the listener if the consumer swaps stores mid-life
   *  (the workspace doesn't, but Storybook stories might). */
  override updated(changed: Map<string, unknown>): void {
    if (changed.has("store")) {
      const old = changed.get("store") as CandidateStore | null | undefined;
      old?.removeEventListener("change", this.#onStoreChange);
      this.store?.addEventListener("change", this.#onStoreChange);
    }
  }

  override render() {
    const candidates = this.store?.list() ?? [];
    const count = candidates.length;
    return html`
      <div class="candidate-panel">
        <div class="candidate-panel-header">Candidates (${count})</div>
        <div class="candidate-panel-body">
          ${
            count === 0
              ? html`<div class="candidate-panel-empty">
                No candidates yet.
                <div class="candidate-panel-empty-sub">
                  Auto Capture lands in Phase 4. For now, use the toolbar's
                  <strong>Capture Once</strong> button to save individual frames.
                </div>
              </div>`
              : nothing
          }
          ${candidates.map(
            (c) => html`<annot-candidate-card
              .candidate=${c}
              @candidate-accept=${(e: Event) => this.#forward(e, "candidate-accept")}
              @candidate-edit=${(e: Event) => this.#forward(e, "candidate-edit")}
              @candidate-delete=${(e: Event) => this.#forward(e, "candidate-delete")}
            ></annot-candidate-card>`,
          )}
        </div>
      </div>
    `;
  }

  #forward(e: Event, name: string): void {
    const detail = (e as CustomEvent).detail;
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
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
