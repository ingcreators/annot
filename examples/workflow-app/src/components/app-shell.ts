import { LitElement, html, css } from "lit";

import "./lang-toggle.js";
import { onLocaleChange, t } from "../i18n.js";
import { getRoute, navigate, onRouteChange, type RouteDescriptor } from "../router.js";

// Phase 1: routes render a single placeholder body. Phase 2+
// swaps these for the real screen components per `screen` field
// in `RouteDescriptor`.
const PHASE1_PLACEHOLDER_SCREENS = new Set([
  "login",
  "menu",
  "applicationForm",
  "applicationConfirm",
  "applicationSubmitted",
  "approvalList",
  "approvalDetail",
  "approvalDecided",
]);

export class WfAppShell extends LitElement {
  // Render to light DOM so global stylesheets apply (CLAUDE.md
  // §Lit conventions, hybrid-CSS while migrating). The example
  // is small enough to stay light-DOM throughout.
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  static override styles = css``;

  #route: RouteDescriptor = getRoute();
  #unsubRoute?: () => void;
  #unsubLocale?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubRoute = onRouteChange((r) => {
      this.#route = r;
      this.requestUpdate();
    });
    this.#unsubLocale = onLocaleChange(() => this.requestUpdate());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unsubRoute?.();
    this.#unsubLocale?.();
  }

  override render(): unknown {
    return html`
      <header class="wf-shell-header" role="banner">
        <div class="wf-shell-header__inner">
          <a
            class="wf-shell-brand"
            href="#/"
            @click=${(e: Event) => this.#goHome(e)}
            data-testid="brand-home"
          >
            ${t("app.title")}
          </a>
          <wf-lang-toggle></wf-lang-toggle>
        </div>
      </header>
      <main class="wf-shell-main" role="main">${this.#renderRoute()}</main>
    `;
  }

  #goHome(e: Event): void {
    e.preventDefault();
    navigate("/");
  }

  #renderRoute(): unknown {
    const r = this.#route;
    if (r.screen === "unknown") {
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
    if (PHASE1_PLACEHOLDER_SCREENS.has(r.screen)) {
      return html`
        <section class="wf-page">
          <div class="wf-card wf-stack" data-testid=${`placeholder-${r.screen}`}>
            <h1 class="wf-heading">${t("placeholder.heading")}</h1>
            <p>${t("placeholder.body")}</p>
            <p class="wf-muted">
              <strong>${t("placeholder.routeLabel")}</strong>
              <code>${r.hash}</code>
            </p>
            <nav class="wf-row">
              <a href="#/login">login</a>
              <a href="#/menu">menu</a>
              <a href="#/apply">apply</a>
              <a href="#/apply/confirm">apply/confirm</a>
              <a href="#/apply/submitted">apply/submitted</a>
              <a href="#/approve">approve</a>
              <a href="#/approve/APP-001">approve/APP-001</a>
              <a href="#/approve/APP-001/decided">approve/APP-001/decided</a>
            </nav>
          </div>
        </section>
      `;
    }
    return html`<p>unhandled screen: ${r.screen}</p>`;
  }
}

customElements.define("wf-app-shell", WfAppShell);

declare global {
  interface HTMLElementTagNameMap {
    "wf-app-shell": WfAppShell;
  }
}
