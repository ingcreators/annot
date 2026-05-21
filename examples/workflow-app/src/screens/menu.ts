import { LitElement, html } from "lit";

import { displayName, formatStatus, formatDateTime } from "../format.js";
import { onLocaleChange, t } from "../i18n.js";
import { navigate } from "../router.js";
import {
  applicationsByApplicant,
  getState,
  onStateChange,
  pendingApprovals,
} from "../state.js";

export class WfMenu extends LitElement {
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
    const user = getState().currentUser;
    if (!user) {
      // Not signed in — bounce back to login. The shell's route
      // guard would normally catch this; this is defensive.
      queueMicrotask(() => navigate("/login"));
      return html``;
    }
    const subheadingKey =
      user.role === "approver"
        ? "menu.subheading.approver"
        : "menu.subheading.applicant";
    return html`
      <section class="wf-page">
        <div class="wf-stack" data-testid="screen-menu" data-role=${user.role}>
          <header class="wf-stack">
            <h1 class="wf-heading">${t("menu.heading")}</h1>
            <p class="wf-muted">
              <span>${t("app.signedInAs")} </span>
              <strong>${displayName(user)}</strong>
              <span class="wf-muted"> (${user.email})</span>
            </p>
            <p>${t(subheadingKey)}</p>
          </header>
          <div class="wf-card-grid">
            ${user.role === "applicant" ? this.#renderApplicantCards() : null}
            ${user.role === "approver" ? this.#renderApproverCards() : null}
          </div>
          ${user.role === "applicant" ? this.#renderApplicantHistory() : null}
        </div>
      </section>
    `;
  }

  #renderApplicantCards(): unknown {
    return html`
      <a
        class="wf-card wf-card--action"
        href="#/apply"
        data-testid="menu-new-application"
        @click=${(e: Event) => this.#go(e, "/apply")}
      >
        <h2 class="wf-subheading">${t("menu.card.newApplication.title")}</h2>
        <p class="wf-muted">${t("menu.card.newApplication.body")}</p>
      </a>
    `;
  }

  #renderApproverCards(): unknown {
    const pending = pendingApprovals();
    return html`
      <a
        class="wf-card wf-card--action"
        href="#/approve"
        data-testid="menu-pending-approvals"
        @click=${(e: Event) => this.#go(e, "/approve")}
      >
        <div class="wf-row" style="justify-content: space-between">
          <h2 class="wf-subheading">${t("menu.card.pendingApprovals.title")}</h2>
          <span class="wf-badge" data-testid="menu-pending-count">
            ${pending.length}
          </span>
        </div>
        <p class="wf-muted">${t("menu.card.pendingApprovals.body")}</p>
      </a>
    `;
  }

  #renderApplicantHistory(): unknown {
    const user = getState().currentUser!;
    const items = applicationsByApplicant(user.id);
    return html`
      <section class="wf-stack" data-testid="menu-my-applications">
        <h2 class="wf-subheading">${t("menu.card.myApplications.title")}</h2>
        ${items.length === 0
          ? html`<p class="wf-muted">${t("menu.myApplications.empty")}</p>`
          : html`
              <ul class="wf-list">
                ${items.map(
                  (app) => html`
                    <li class="wf-list__row" data-app-id=${app.id}>
                      <div class="wf-list__main">
                        <strong>${app.id}</strong>
                        <span class="wf-muted">
                          ${t(`form.category.${app.category}`)}
                        </span>
                      </div>
                      <span class="wf-muted">
                        ${formatDateTime(app.submittedAt)}
                      </span>
                      <span
                        class="wf-status"
                        data-status=${app.status}
                      >
                        ${formatStatus(app.status)}
                      </span>
                    </li>
                  `,
                )}
              </ul>
            `}
      </section>
    `;
  }

  #go(e: Event, path: string): void {
    e.preventDefault();
    navigate(path);
  }
}

customElements.define("wf-menu", WfMenu);

declare global {
  interface HTMLElementTagNameMap {
    "wf-menu": WfMenu;
  }
}
