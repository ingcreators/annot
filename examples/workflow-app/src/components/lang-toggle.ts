import { LitElement, html } from "lit";

import {
  availableLocales,
  getLocale,
  onLocaleChange,
  setLocale,
  t,
  type Locale,
} from "../i18n.js";

export class WfLangToggle extends LitElement {
  // Light DOM — global styles apply, and Playwright selectors
  // + `data-testid` queries reach the buttons without piercing
  // shadow boundaries.
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  #unsubscribe?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubscribe = onLocaleChange(() => this.requestUpdate());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unsubscribe?.();
  }

  override render(): unknown {
    const current = getLocale();
    return html`
      <span class="wf-lang-toggle__label">${t("app.lang.label")}</span>
      <div
        class="wf-lang-toggle__group"
        role="group"
        aria-label=${t("app.lang.label")}
      >
        ${availableLocales().map(
          (loc) => html`
            <button
              type="button"
              data-testid=${`lang-${loc}`}
              aria-pressed=${current === loc ? "true" : "false"}
              @click=${() => this.#pick(loc)}
            >
              ${t(`app.lang.${loc}`)}
            </button>
          `,
        )}
      </div>
    `;
  }

  #pick(loc: Locale): void {
    setLocale(loc);
  }
}

customElements.define("wf-lang-toggle", WfLangToggle);

declare global {
  interface HTMLElementTagNameMap {
    "wf-lang-toggle": WfLangToggle;
  }
}
