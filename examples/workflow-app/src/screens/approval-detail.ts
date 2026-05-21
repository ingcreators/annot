import { LitElement, html } from "lit";

import {
  displayName,
  formatAmount,
  formatCategory,
  formatDateTime,
} from "../format.js";
import { onLocaleChange, t } from "../i18n.js";
import { getRoute, navigate, onRouteChange } from "../router.js";
import {
  decideApplication,
  findApplication,
  findUser,
  getState,
  onStateChange,
} from "../state.js";

export class WfApprovalDetail extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  static override properties = {
    comment: { state: true },
  };

  declare comment: string;

  #unsubLocale?: () => void;
  #unsubState?: () => void;
  #unsubRoute?: () => void;

  constructor() {
    super();
    this.comment = "";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubLocale = onLocaleChange(() => this.requestUpdate());
    this.#unsubState = onStateChange(() => this.requestUpdate());
    this.#unsubRoute = onRouteChange(() => {
      this.comment = "";
      this.requestUpdate();
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unsubLocale?.();
    this.#unsubState?.();
    this.#unsubRoute?.();
  }

  override render(): unknown {
    const user = getState().currentUser;
    if (!user || user.role !== "approver") {
      queueMicrotask(() => navigate("/menu"));
      return html``;
    }
    const id = getRoute().params["id"];
    if (!id) {
      queueMicrotask(() => navigate("/approve"));
      return html``;
    }
    const app = findApplication(id);
    if (!app) {
      return html`
        <section class="wf-page wf-page--narrow">
          <div class="wf-card wf-stack" data-testid="screen-approval-detail">
            <h1 class="wf-heading">${t("approve.detail.heading")}</h1>
            <p class="wf-error" data-testid="approval-detail-not-found">
              ${t("approve.detail.notFound")}
            </p>
            <p>
              <a href="#/approve" @click=${(e: Event) => this.#back(e)}>
                ${t("approve.detail.backToList")}
              </a>
            </p>
          </div>
        </section>
      `;
    }
    const applicant = findUser(app.applicantId);
    const decided = app.status !== "submitted";
    return html`
      <section class="wf-page wf-page--narrow">
        <div
          class="wf-card wf-stack"
          data-testid="screen-approval-detail"
          data-app-id=${app.id}
        >
          <header class="wf-stack">
            <h1 class="wf-heading">${t("approve.detail.heading")}</h1>
          </header>
          <dl class="wf-defs">
            <div class="wf-defs__row">
              <dt>${t("approve.detail.field.id")}</dt>
              <dd data-testid="approval-detail-id">${app.id}</dd>
            </div>
            <div class="wf-defs__row">
              <dt>${t("approve.detail.field.applicant")}</dt>
              <dd data-testid="approval-detail-applicant">
                ${displayName(applicant)}
                ${applicant ? html`<span class="wf-muted"> (${applicant.email})</span>` : null}
              </dd>
            </div>
            <div class="wf-defs__row">
              <dt>${t("approve.detail.field.category")}</dt>
              <dd data-testid="approval-detail-category">
                ${formatCategory(app.category)}
              </dd>
            </div>
            <div class="wf-defs__row">
              <dt>${t("approve.detail.field.amount")}</dt>
              <dd data-testid="approval-detail-amount">
                ${formatAmount(app.amount, app.category)}
              </dd>
            </div>
            <div class="wf-defs__row">
              <dt>${t("approve.detail.field.submittedAt")}</dt>
              <dd data-testid="approval-detail-submitted-at">
                ${formatDateTime(app.submittedAt)}
              </dd>
            </div>
            <div class="wf-defs__row">
              <dt>${t("approve.detail.field.reason")}</dt>
              <dd data-testid="approval-detail-reason">${app.reason}</dd>
            </div>
          </dl>
          ${decided
            ? html`
                <p class="wf-muted" data-testid="approval-detail-already-decided">
                  ${t("approve.detail.alreadyDecided")}
                </p>
                <p>
                  <a href="#/approve" @click=${(e: Event) => this.#back(e)}>
                    ${t("approve.detail.backToList")}
                  </a>
                </p>
              `
            : html`
                <div class="wf-field">
                  <label class="wf-label" for="approve-comment">
                    ${t("approve.detail.comment.label")}
                    <span class="wf-muted">(${t("common.optional")})</span>
                  </label>
                  <textarea
                    id="approve-comment"
                    class="wf-input"
                    rows="3"
                    data-testid="approval-comment"
                    placeholder=${t("approve.detail.comment.placeholder")}
                    .value=${this.comment}
                    @input=${(e: Event) => {
                      this.comment = (e.target as HTMLTextAreaElement).value;
                    }}
                  ></textarea>
                </div>
                <div class="wf-row" style="justify-content: space-between">
                  <button
                    type="button"
                    class="wf-button"
                    data-variant="danger"
                    data-testid="approval-reject"
                    @click=${() => this.#decide(app.id, "rejected")}
                  >
                    ${t("approve.detail.reject")}
                  </button>
                  <button
                    type="button"
                    class="wf-button"
                    data-variant="primary"
                    data-testid="approval-approve"
                    @click=${() => this.#decide(app.id, "approved")}
                  >
                    ${t("approve.detail.approve")}
                  </button>
                </div>
              `}
        </div>
      </section>
    `;
  }

  #decide(id: string, decision: "approved" | "rejected"): void {
    const result = decideApplication(id, decision, this.comment);
    if (result) {
      navigate(`/approve/${id}/decided`);
    }
  }

  #back(e: Event): void {
    e.preventDefault();
    navigate("/approve");
  }
}

customElements.define("wf-approval-detail", WfApprovalDetail);

declare global {
  interface HTMLElementTagNameMap {
    "wf-approval-detail": WfApprovalDetail;
  }
}
