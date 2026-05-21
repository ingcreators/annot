import { LitElement, html } from "lit";

import "./lang-toggle.js";
import "../screens/login.js";
import "../screens/menu.js";
import "../screens/application-form.js";
import "../screens/application-confirm.js";
import "../screens/application-submitted.js";
import { displayName } from "../format.js";
import { onLocaleChange, t } from "../i18n.js";
import {
  getRoute,
  navigate,
  onRouteChange,
  type RouteDescriptor,
  type ScreenId,
} from "../router.js";
import {
  getState,
  onStateChange,
  signOut,
  type Role,
} from "../state.js";

// Routes that require authentication. The route guard sends an
// anonymous user to /login on access.
const PROTECTED_SCREENS = new Set<ScreenId>([
  "menu",
  "applicationForm",
  "applicationConfirm",
  "applicationSubmitted",
  "approvalList",
  "approvalDetail",
  "approvalDecided",
]);

// Routes that gate by role. Mismatch sends the user back to
// /menu (where their role's variant is rendered).
const APPLICANT_ONLY = new Set<ScreenId>([
  "applicationForm",
  "applicationConfirm",
  "applicationSubmitted",
]);
const APPROVER_ONLY = new Set<ScreenId>([
  "approvalList",
  "approvalDetail",
  "approvalDecided",
]);

// Phase 3 screens not yet implemented — render the placeholder.
const PENDING_SCREENS = new Set<ScreenId>([
  "approvalList",
  "approvalDetail",
  "approvalDecided",
]);

export class WfAppShell extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  #route: RouteDescriptor = getRoute();
  #unsubRoute?: () => void;
  #unsubLocale?: () => void;
  #unsubState?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubRoute = onRouteChange((r) => {
      this.#route = r;
      this.#applyGuards();
      this.requestUpdate();
    });
    this.#unsubLocale = onLocaleChange(() => this.requestUpdate());
    this.#unsubState = onStateChange(() => {
      this.#applyGuards();
      this.requestUpdate();
    });
    this.#applyGuards();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unsubRoute?.();
    this.#unsubLocale?.();
    this.#unsubState?.();
  }

  override render(): unknown {
    const user = getState().currentUser;
    return html`
      <header class="wf-shell-header" role="banner">
        <div class="wf-shell-header__inner">
          <a
            class="wf-shell-brand"
            href=${user ? "#/menu" : "#/login"}
            @click=${(e: Event) => this.#goHome(e)}
            data-testid="brand-home"
          >
            ${t("app.title")}
          </a>
          <div class="wf-shell-header__right">
            ${user
              ? html`
                  <span
                    class="wf-user-chip"
                    data-testid="user-chip"
                    data-role=${user.role}
                  >
                    <span class="wf-user-chip__name">${displayName(user)}</span>
                    <span class="wf-user-chip__role">${this.#roleLabel(user.role)}</span>
                  </span>
                  <button
                    type="button"
                    class="wf-button wf-button--ghost"
                    data-testid="sign-out"
                    @click=${() => this.#signOut()}
                  >
                    ${t("app.signOut")}
                  </button>
                `
              : null}
            <wf-lang-toggle></wf-lang-toggle>
          </div>
        </div>
      </header>
      <main class="wf-shell-main" role="main">${this.#renderRoute()}</main>
    `;
  }

  #roleLabel(role: Role): string {
    return role === "approver" ? t("login.hint.approver") : t("login.hint.applicant");
  }

  #applyGuards(): void {
    const user = getState().currentUser;
    const r = this.#route;
    if (r.screen === "unknown") {
      return;
    }
    if (!user && PROTECTED_SCREENS.has(r.screen)) {
      navigate("/login");
      return;
    }
    if (user && r.screen === "login") {
      navigate("/menu");
      return;
    }
    if (user) {
      if (user.role === "approver" && APPLICANT_ONLY.has(r.screen)) {
        navigate("/menu");
        return;
      }
      if (user.role === "applicant" && APPROVER_ONLY.has(r.screen)) {
        navigate("/menu");
        return;
      }
    }
  }

  #goHome(e: Event): void {
    e.preventDefault();
    const user = getState().currentUser;
    navigate(user ? "/menu" : "/login");
  }

  #signOut(): void {
    signOut();
    navigate("/login");
  }

  #renderRoute(): unknown {
    const r = this.#route;
    if (r.screen === "unknown") {
      return this.#renderNotFound(r);
    }
    if (PENDING_SCREENS.has(r.screen)) {
      return this.#renderPlaceholder(r);
    }
    switch (r.screen) {
      case "login":
        return html`<wf-login></wf-login>`;
      case "menu":
        return html`<wf-menu></wf-menu>`;
      case "applicationForm":
        return html`<wf-application-form></wf-application-form>`;
      case "applicationConfirm":
        return html`<wf-application-confirm></wf-application-confirm>`;
      case "applicationSubmitted":
        return html`<wf-application-submitted></wf-application-submitted>`;
      default:
        return this.#renderPlaceholder(r);
    }
  }

  #renderNotFound(r: RouteDescriptor): unknown {
    return html`
      <section class="wf-page">
        <div class="wf-card wf-stack">
          <h1 class="wf-heading">404</h1>
          <p class="wf-muted">${r.hash}</p>
          <p>
            <a href="#/" @click=${(e: Event) => this.#goHome(e)}>
              ${t("common.back")}
            </a>
          </p>
        </div>
      </section>
    `;
  }

  #renderPlaceholder(r: RouteDescriptor): unknown {
    return html`
      <section class="wf-page">
        <div
          class="wf-card wf-stack"
          data-testid=${`placeholder-${r.screen}`}
        >
          <h1 class="wf-heading">${t("placeholder.heading")}</h1>
          <p>${t("placeholder.body")}</p>
          <p class="wf-muted">
            <strong>${t("placeholder.routeLabel")}</strong>
            <code>${r.hash}</code>
          </p>
        </div>
      </section>
    `;
  }
}

customElements.define("wf-app-shell", WfAppShell);

declare global {
  interface HTMLElementTagNameMap {
    "wf-app-shell": WfAppShell;
  }
}
