import { LitElement, html } from "lit";

import { onLocaleChange, t } from "../i18n.js";
import { navigate } from "../router.js";
import { getState, onStateChange } from "../state.js";

export class WfApplicationSubmitted extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  #unsubLocale?: () => void;
  #unsubState?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubLocale = onLocaleChange(() => this.requestUpdate());
    this.#unsubState = onStateChange(() => this.requestUpdate());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unsubLocale?.();
    this.#unsubState?.();
  }

  override render(): unknown {
    const { currentUser, lastSubmittedId } = getState();
    if (!currentUser) {
      queueMicrotask(() => navigate("/login"));
      return html``;
    }
    if (!lastSubmittedId) {
      // Hard refresh on this URL — no submission in flight.
      queueMicrotask(() => navigate("/menu"));
      return html``;
    }
    return html`
      <section class="wf-page wf-page--narrow">
        <div
          class="wf-card wf-stack"
          data-testid="screen-application-submitted"
        >
          <h1 class="wf-heading">${t("submitted.heading")}</h1>
          <p>${t("submitted.body")}</p>
          <p class="wf-muted">
            <span>${t("submitted.idLabel")} </span>
            <strong data-testid="submitted-id">${lastSubmittedId}</strong>
          </p>
          <div class="wf-row">
            <button
              type="button"
              class="wf-button"
              data-variant="primary"
              data-testid="submitted-back-to-menu"
              @click=${() => navigate("/menu")}
            >
              ${t("submitted.backToMenu")}
            </button>
          </div>
        </div>
      </section>
    `;
  }
}

customElements.define("wf-application-submitted", WfApplicationSubmitted);

declare global {
  interface HTMLElementTagNameMap {
    "wf-application-submitted": WfApplicationSubmitted;
  }
}
