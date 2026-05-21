import { LitElement, html } from "lit";

import {
  displayName,
  formatAmount,
  formatCategory,
  formatDateTime,
} from "../format.js";
import { onLocaleChange, t } from "../i18n.js";
import { navigate } from "../router.js";
import {
  findUser,
  getState,
  onStateChange,
  pendingApprovals,
} from "../state.js";

export class WfApprovalList extends LitElement {
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
    if (!user || user.role !== "approver") {
      queueMicrotask(() => navigate("/menu"));
      return html``;
    }
    const items = pendingApprovals();
    return html`
      <section class="wf-page">
        <div class="wf-stack" data-testid="screen-approval-list">
          <header class="wf-stack">
            <h1 class="wf-heading">${t("approve.list.heading")}</h1>
            <p class="wf-muted">${t("approve.list.subheading")}</p>
          </header>
          ${items.length === 0
            ? html`
                <div class="wf-card">
                  <p class="wf-muted" data-testid="approval-list-empty">
                    ${t("approve.list.empty")}
                  </p>
                </div>
              `
            : html`
                <div class="wf-table-wrap">
                  <table class="wf-table">
                    <thead>
                      <tr>
                        <th scope="col">${t("approve.list.column.id")}</th>
                        <th scope="col">
                          ${t("approve.list.column.applicant")}
                        </th>
                        <th scope="col">
                          ${t("approve.list.column.category")}
                        </th>
                        <th scope="col">${t("approve.list.column.amount")}</th>
                        <th scope="col">
                          ${t("approve.list.column.submittedAt")}
                        </th>
                        <th scope="col">
                          <span class="wf-visually-hidden">
                            ${t("approve.list.column.action")}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      ${items.map((app) => {
                        const applicant = findUser(app.applicantId);
                        return html`
                          <tr data-testid=${`approval-row-${app.id}`}>
                            <td>${app.id}</td>
                            <td>${displayName(applicant)}</td>
                            <td>${formatCategory(app.category)}</td>
                            <td class="wf-table__amount">
                              ${formatAmount(app.amount, app.category)}
                            </td>
                            <td>${formatDateTime(app.submittedAt)}</td>
                            <td>
                              <a
                                class="wf-button wf-button--ghost"
                                href=${`#/approve/${app.id}`}
                                data-testid=${`approval-review-${app.id}`}
                                @click=${(e: Event) =>
                                  this.#go(e, `/approve/${app.id}`)}
                              >
                                ${t("approve.list.review")}
                              </a>
                            </td>
                          </tr>
                        `;
                      })}
                    </tbody>
                  </table>
                </div>
              `}
        </div>
      </section>
    `;
  }

  #go(e: Event, path: string): void {
    e.preventDefault();
    navigate(path);
  }
}

customElements.define("wf-approval-list", WfApprovalList);

declare global {
  interface HTMLElementTagNameMap {
    "wf-approval-list": WfApprovalList;
  }
}
