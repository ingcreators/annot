import { LitElement, html } from "lit";

import { onLocaleChange, t } from "../i18n.js";
import { navigate } from "../router.js";
import { SEED_PASSWORD, SEED_USERS, signIn } from "../state.js";

export class WfLogin extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  static override properties = {
    email: { state: true },
    password: { state: true },
    error: { state: true },
  };

  declare email: string;
  declare password: string;
  declare error: string;

  #unsubLocale?: () => void;

  constructor() {
    super();
    this.email = "";
    this.password = "";
    this.error = "";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubLocale = onLocaleChange(() => this.requestUpdate());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unsubLocale?.();
  }

  override render(): unknown {
    const applicants = SEED_USERS.filter((u) => u.role === "applicant");
    const approvers = SEED_USERS.filter((u) => u.role === "approver");
    return html`
      <section class="wf-page wf-page--narrow">
        <div class="wf-card wf-stack" data-testid="screen-login">
          <h1 class="wf-heading">${t("login.heading")}</h1>
          <p class="wf-muted">${t("login.subheading")}</p>
          <form class="wf-stack" @submit=${(e: Event) => this.#submit(e)}>
            <div class="wf-field">
              <label class="wf-label" for="login-email">
                ${t("login.email")}
              </label>
              <input
                id="login-email"
                class="wf-input"
                type="email"
                required
                autocomplete="email"
                data-testid="login-email"
                .value=${this.email}
                @input=${(e: Event) => {
                  this.email = (e.target as HTMLInputElement).value;
                  this.error = "";
                }}
              />
            </div>
            <div class="wf-field">
              <label class="wf-label" for="login-password">
                ${t("login.password")}
              </label>
              <input
                id="login-password"
                class="wf-input"
                type="password"
                required
                autocomplete="current-password"
                data-testid="login-password"
                .value=${this.password}
                @input=${(e: Event) => {
                  this.password = (e.target as HTMLInputElement).value;
                  this.error = "";
                }}
              />
            </div>
            ${this.error
              ? html`
                  <p class="wf-error" role="alert" data-testid="login-error">
                    ${this.error}
                  </p>
                `
              : null}
            <button
              type="submit"
              class="wf-button"
              data-variant="primary"
              data-testid="login-submit"
            >
              ${t("login.submit")}
            </button>
          </form>
          <aside class="wf-callout" data-testid="login-hint">
            <h2 class="wf-callout__title">${t("login.hint.title")}</h2>
            <p class="wf-callout__body">${t("login.hint.body")}</p>
            <dl class="wf-callout__list">
              ${applicants.length
                ? html`
                    <dt>${t("login.hint.applicant")}</dt>
                    <dd>${applicants.map((u) => u.email).join(", ")}</dd>
                  `
                : null}
              ${approvers.length
                ? html`
                    <dt>${t("login.hint.approver")}</dt>
                    <dd>${approvers.map((u) => u.email).join(", ")}</dd>
                  `
                : null}
            </dl>
            <p class="wf-callout__footer">
              <code>${SEED_PASSWORD}</code>
            </p>
          </aside>
        </div>
      </section>
    `;
  }

  #submit(e: Event): void {
    e.preventDefault();
    const user = signIn(this.email, this.password);
    if (!user) {
      this.error = t("login.error.invalid");
      return;
    }
    navigate("/menu");
  }
}

customElements.define("wf-login", WfLogin);

declare global {
  interface HTMLElementTagNameMap {
    "wf-login": WfLogin;
  }
}
