import { LitElement, html } from "lit";

import { formatStatus } from "../format.js";
import { onLocaleChange, t } from "../i18n.js";
import { getRoute, navigate, onRouteChange } from "../router.js";
import { findApplication, getState, onStateChange } from "../state.js";

export class WfApprovalDecided extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  #unsubLocale?: () => void;
  #unsubState?: () => void;
  #unsubRoute?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubLocale = onLocaleChange(() => this.requestUpdate());
    this.#unsubState = onStateChange(() => this.requestUpdate());
    this.#unsubRoute = onRouteChange(() => this.requestUpdate());
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
    const app = id ? findApplication(id) : undefined;
    if (!app || app.status === "submitted") {
      queueMicrotask(() => navigate("/approve"));
      return html``;
    }
    const headingKey =
      app.status === "approved"
        ? "approve.decided.heading.approved"
        : "approve.decided.heading.rejected";
    return html`
      <section class="wf-page wf-page--narrow">
        <div
          class="wf-card wf-stack"
          data-testid="screen-approval-decided"
          data-decision=${app.status}
        >
          <h1 class="wf-heading">${t(headingKey)}</h1>
          <p>${t("approve.decided.body")}</p>
          <dl class="wf-defs">
            <div class="wf-defs__row">
              <dt>${t("approve.detail.field.id")}</dt>
              <dd data-testid="decided-id">${app.id}</dd>
            </div>
            <div class="wf-defs__row">
              <dt>${t("approve.decided.field.decision")}</dt>
              <dd>
                <span class="wf-status" data-status=${app.status}>
                  ${formatStatus(app.status)}
                </span>
              </dd>
            </div>
            ${app.decisionComment
              ? html`
                  <div class="wf-defs__row">
                    <dt>${t("approve.detail.comment.label")}</dt>
                    <dd data-testid="decided-comment">
                      ${app.decisionComment}
                    </dd>
                  </div>
                `
              : null}
          </dl>
          <div class="wf-row">
            <button
              type="button"
              class="wf-button"
              data-variant="primary"
              data-testid="decided-back-to-list"
              @click=${() => navigate("/approve")}
            >
              ${t("approve.decided.backToList")}
            </button>
          </div>
        </div>
      </section>
    `;
  }
}

customElements.define("wf-approval-decided", WfApprovalDecided);

declare global {
  interface HTMLElementTagNameMap {
    "wf-approval-decided": WfApprovalDecided;
  }
}
