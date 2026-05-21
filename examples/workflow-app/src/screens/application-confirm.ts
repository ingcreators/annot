import { LitElement, html } from "lit";

import { displayName, formatAmount, formatCategory } from "../format.js";
import { onLocaleChange, t } from "../i18n.js";
import { navigate } from "../router.js";
import { getState, onStateChange, submitDraft } from "../state.js";

export class WfApplicationConfirm extends LitElement {
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
    const { currentUser, draft, lastSubmittedId } = getState();
    if (!currentUser || currentUser.role !== "applicant") {
      queueMicrotask(() => navigate("/menu"));
      return html``;
    }
    if (!draft || draft.category === "" || draft.reason.trim() === "") {
      // The submit handler clears the draft AND sets
      // lastSubmittedId before it calls navigate. Do not race
      // it back to /apply — let the navigation to
      // /apply/submitted go through.
      if (!lastSubmittedId) {
        queueMicrotask(() => navigate("/apply"));
      }
      return html``;
    }
    return html`
      <section class="wf-page wf-page--narrow">
        <div class="wf-card wf-stack" data-testid="screen-application-confirm">
          <h1 class="wf-heading">${t("confirm.heading")}</h1>
          <p class="wf-muted">${t("confirm.subheading")}</p>
          <dl class="wf-defs">
            <div class="wf-defs__row">
              <dt>${t("confirm.field.applicant")}</dt>
              <dd data-testid="confirm-applicant">
                ${displayName(currentUser)} (${currentUser.email})
              </dd>
            </div>
            <div class="wf-defs__row">
              <dt>${t("confirm.field.category")}</dt>
              <dd data-testid="confirm-category">
                ${formatCategory(draft.category)}
              </dd>
            </div>
            <div class="wf-defs__row">
              <dt>${t("confirm.field.amount")}</dt>
              <dd data-testid="confirm-amount">
                ${formatAmount(draft.amount, draft.category)}
              </dd>
            </div>
            <div class="wf-defs__row">
              <dt>${t("confirm.field.reason")}</dt>
              <dd data-testid="confirm-reason">${draft.reason}</dd>
            </div>
          </dl>
          <div class="wf-row" style="justify-content: space-between">
            <button
              type="button"
              class="wf-button"
              data-testid="confirm-back"
              @click=${() => navigate("/apply")}
            >
              ${t("confirm.back")}
            </button>
            <button
              type="button"
              class="wf-button"
              data-variant="primary"
              data-testid="confirm-submit"
              @click=${() => this.#submit()}
            >
              ${t("confirm.submit")}
            </button>
          </div>
        </div>
      </section>
    `;
  }

  #submit(): void {
    const app = submitDraft();
    if (app) {
      navigate("/apply/submitted");
    }
  }
}

customElements.define("wf-application-confirm", WfApplicationConfirm);

declare global {
  interface HTMLElementTagNameMap {
    "wf-application-confirm": WfApplicationConfirm;
  }
}
